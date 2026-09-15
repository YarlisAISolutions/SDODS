import { existsSync, readFileSync } from 'node:fs';
import './params.js';
import { Given, When } from '../fixtures/test.js';
import type { HttpMethod } from '../api/client.js';
import { tokenFileFor } from '../auth/capture.js';
import type { AuthStrategy, PoolUserLike } from '../auth/index.js';
import type { ResolvedConfig } from '../config/resolve.js';
import { renderStrict } from '../api/template.js';
import { scenarioLeaseClock } from '../data/user-pool.js';
import type { LeasedUser, UserPool } from '../data/types.js';
import { SdodsError } from '../errors.js';
import { Logger } from '../logger.js';

const log = new Logger('data');

/* ── datasets ─────────────────────────────────────────────────────────── */

Given(
  'I load dataset {string} row {int}',
  async ({ data, apiContext }, name: string, index: number) => {
    apiContext.vars.setAll(await data.row(name, index));
  },
);

Given(
  'I load dataset {string} where {string} is {string}',
  async ({ data, apiContext }, name: string, column: string, value: string) => {
    const row = await data.find(name, { [column]: value });
    if (!row)
      throw new SdodsError(
        'DATASET_ROW_NOT_FOUND',
        `No row in dataset "${name}" where ${column} = "${value}".`,
      );
    apiContext.vars.setAll(row);
  },
);

Given(
  'I generate a {string} from the factory as {string}',
  async ({ data, apiContext }, factory: string, as: string) => {
    apiContext.vars.set(as, await data.factory(factory));
  },
);

/* ── user pool ────────────────────────────────────────────────────────── */

Given(
  'I use a leased user with role {string}',
  async (
    { userPool, authCache, auth, sdods, apiContext, page, context, browser, config, $testInfo },
    role: string,
  ) => {
    const user = await leaseInScenario(userPool, config, role, $testInfo);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
      ...user.extra,
    });
    LEASED.set(apiContext, user);
    if (sdods.layer !== 'api') await authCache.apply({ context, page, user, auth, browser });
  },
);

Given(
  'I use the user {string} from the pool',
  async ({ userPool, apiContext, config, $testInfo }, username: string) => {
    const status = await userPool.status();
    const entry = status.find((u) => u.username === username);
    if (!entry) throw new SdodsError('DATASET_ROW_NOT_FOUND', `No pool user named "${username}".`);
    const user = await leaseInScenario(userPool, config, entry.role, $testInfo);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
    });
    LEASED.set(apiContext, user);
  },
);

/**
 * API-layer variant: leases the account, exposes its credentials as variables,
 * AND authenticates the API client as that user.
 *
 * The authentication half used to be missing, which left the whole role-based
 * API story unwired. Three seams were dead at once:
 *
 *   1. `storageState` is forced to undefined when `sdods.layer === 'api'`
 *      (fixtures/test.ts) — correct in itself, an API test should not need a
 *      browser, but it means the `@user:<role>` tag applies no credential here.
 *   2. This step set variables and performed no authentication.
 *   3. The strategy's `token()` result was written to
 *      `<role>-<n>.token.json` by `sdods auth capture` and never read back.
 *
 * The net effect was that every API request in a role-tagged scenario went out
 * anonymous. Against an app that answers 401 the scenario failed loudly, which
 * is survivable — but against one that answers 200 to anonymous reads, an
 * authorization scenario passed while proving nothing at all.
 *
 * Resolution order: the cached token file (so `sdods auth capture` is
 * meaningful and one mint is reused across a sharded run), then a live
 * `token()` call. A strategy with no `token()` leaves auth unset and says so,
 * rather than silently continuing anonymous.
 *
 * Attaching the token is itself a choice of credential class, though, and it
 * must not be made behind the scenario's back (#87). A `custom` strategy's
 * `token()` can mint a personal API key for an app whose scenarios also sign
 * in with a session; attached silently, such a scenario sends BOTH, and "a key
 * is refused on a session-only route" passes on whichever one the server reads
 * first. So `auth.apiToken` decides: `implicit` attaches here, `explicit` only
 * leases and the scenario says `I authenticate the API with the leased user's
 * token`. Unset, `custom` is explicit and every other strategy keeps the
 * implicit behaviour #18 introduced — for `token` and
 * `oauth-client-credentials` the token is the only credential there is.
 * Either way the attached credential is logged at info.
 */
Given(
  'I use a leased user with role {string} for API calls',
  async ({ userPool, apiContext, auth, config, $testInfo }, role: string) => {
    const user = await leaseInScenario(userPool, config, role, $testInfo);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
      ...user.extra,
    });
    LEASED.set(apiContext, user);

    if (apiTokenMode(config, auth) === 'explicit') {
      log.info(
        `leased ${user.username} (${role}) for API calls; no credential attached ` +
          `(auth.apiToken: explicit). Add "I authenticate the API with the leased user's token" to send its token.`,
      );
      return;
    }
    const found = await leasedUserToken(config, auth, user);
    if (found) {
      apiContext.auth = { type: 'bearer', token: found.token };
      log.info(
        `API calls authenticate as ${user.username} (${role}): bearer token from ${found.source}.`,
      );
    } else if (auth?.strategy && auth.strategy !== 'none') {
      log.info(
        `auth strategy "${auth.strategy}" provides no token() — API calls for ` +
          `${user.username} (${role}) use the environment credential.`,
      );
    }
  },
);

Given(
  "I authenticate the API with the leased user's token",
  async ({ apiContext, auth, config }) => {
    const user = LEASED.get(apiContext);
    if (!user) {
      throw new SdodsError('AUTH_FAILED', 'No user has been leased in this scenario yet.', {
        hint: 'Lease one first with `Given I use a leased user with role "<role>" for API calls` (or `I use a leased user with role "<role>"`).',
      });
    }
    const found = await leasedUserToken(config, auth, user);
    if (!found) {
      throw new SdodsError(
        'AUTH_FAILED',
        `No API token for ${user.username} (${user.role}): no cached token file and the "${auth?.strategy ?? 'none'}" auth strategy's token() returned none.`,
        {
          hint: `Run \`sdods auth capture --user ${user.role}\` to cache one, or implement token() in the project's defineAuth.`,
        },
      );
    }
    apiContext.auth = { type: 'bearer', token: found.token };
    log.info(
      `API calls authenticate as ${user.username} (${user.role}): bearer token from ${found.source}.`,
    );
  },
);

/** The user the scenario leased, so the explicit token step authenticates as that same account. */
const LEASED = new WeakMap<object, PoolUserLike>();

/**
 * Lease for this scenario. With `leaseScope: scenario` the wait for a free account is added to the
 * scenario's timeout, and `$sdodsScenarioLeases` releases the account when the scenario ends.
 */
async function leaseInScenario(
  userPool: UserPool,
  config: ResolvedConfig,
  role: string,
  testInfo: { parallelIndex: number; timeout: number; setTimeout(ms: number): void },
): Promise<LeasedUser> {
  // `data` is always present on a resolved config; unit tests hand steps a partial one.
  const clock = scenarioLeaseClock(config.project.data?.userPool, testInfo);
  const user = await userPool.lease(role, testInfo.parallelIndex);
  clock.settle();
  return user;
}

function apiTokenMode(
  config: ResolvedConfig,
  auth: AuthStrategy | undefined,
): 'implicit' | 'explicit' {
  return config.project.auth?.apiToken ?? (auth?.strategy === 'custom' ? 'explicit' : 'implicit');
}

/** The cached `sdods auth capture` token, else a live `token()` — with where it came from. */
async function leasedUserToken(
  config: ResolvedConfig,
  auth: AuthStrategy | undefined,
  user: PoolUserLike,
): Promise<{ token: string; source: string } | undefined> {
  const file = tokenFileFor(config, user);
  const cached = readCachedToken(file);
  if (cached) return { token: cached, source: `cached token file ${file}` };
  const minted = await auth?.token?.({ config, user });
  return minted
    ? { token: minted, source: `the "${auth?.strategy}" strategy's token()` }
    : undefined;
}

/** The token `sdods auth capture` wrote for this user, when it is still there. */
function readCachedToken(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { token?: string };
    return parsed.token;
  } catch {
    // A corrupt cache must not fail the scenario — fall through to a live mint.
    return undefined;
  }
}

/* ── cleanup ──────────────────────────────────────────────────────────── */

When(
  'I register cleanup {method} {string}',
  async ({ data, api, apiContext, env }, method: HttpMethod, path: string) => {
    const rendered = renderStrict(path, apiContext.vars.toObject(), env.vars);
    data.registerCleanup(async () => {
      await api.send(method, rendered, { silent: true });
    }, `${method} ${rendered}`);
  },
);
