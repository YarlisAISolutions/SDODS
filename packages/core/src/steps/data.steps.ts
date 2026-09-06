import { existsSync, readFileSync } from 'node:fs';
import './params.js';
import { Given, When } from '../fixtures/test.js';
import type { HttpMethod } from '../api/client.js';
import { tokenFileFor } from '../auth/capture.js';
import type { PoolUserLike } from '../auth/index.js';
import type { ResolvedConfig } from '../config/resolve.js';
import { render } from '../api/template.js';
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
    { userPool, authCache, auth, sdods, apiContext, page, context, browser, $testInfo },
    role: string,
  ) => {
    const user = await userPool.lease(role, $testInfo.parallelIndex);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
      ...user.extra,
    });
    if (sdods.layer !== 'api') await authCache.apply({ context, page, user, auth, browser });
  },
);

Given(
  'I use the user {string} from the pool',
  async ({ userPool, apiContext, $testInfo }, username: string) => {
    const status = await userPool.status();
    const entry = status.find((u) => u.username === username);
    if (!entry) throw new SdodsError('DATASET_ROW_NOT_FOUND', `No pool user named "${username}".`);
    const user = await userPool.lease(entry.role, $testInfo.parallelIndex);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
    });
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
 */
Given(
  'I use a leased user with role {string} for API calls',
  async ({ userPool, apiContext, auth, config, $testInfo }, role: string) => {
    const user = await userPool.lease(role, $testInfo.parallelIndex);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
      ...user.extra,
    });

    const token = readCachedToken(config, user) ?? (await auth?.token?.({ config, user }));
    if (token) apiContext.auth = { type: 'bearer', token };
    else if (auth?.strategy && auth.strategy !== 'none') {
      log.debug(
        `auth strategy "${auth.strategy}" provides no token() — API calls for ` +
          `${user.username} (${role}) use the environment credential.`,
      );
    }
  },
);

/** The token `sdods auth capture` wrote for this user, when it is still there. */
function readCachedToken(config: ResolvedConfig, user: PoolUserLike): string | undefined {
  const file = tokenFileFor(config, user);
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
    const rendered = render(path, apiContext.vars.toObject(), env.vars);
    data.registerCleanup(async () => {
      await api.send(method, rendered, { silent: true });
    }, `${method} ${rendered}`);
  },
);
