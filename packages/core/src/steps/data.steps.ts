import './params.js';
import { Given, When } from '../fixtures/test.js';
import type { HttpMethod } from '../api/client.js';
import { render } from '../api/template.js';
import { SdodsError } from '../errors.js';

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

/** API-layer variant: leases the account and exposes its credentials without touching a browser. */
Given(
  'I use a leased user with role {string} for API calls',
  async ({ userPool, apiContext, $testInfo }, role: string) => {
    const user = await userPool.lease(role, $testInfo.parallelIndex);
    apiContext.vars.setAll({
      username: user.username,
      password: user.password,
      userId: user.id,
      role: user.role,
      ...user.extra,
    });
  },
);

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
