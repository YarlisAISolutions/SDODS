import { expect } from '@playwright/test';
import './params.js';
import { Then, When } from '../fixtures/test.js';
import { render } from '../api/template.js';
import { SdodsError } from '../errors.js';
import type { DbHandle } from '../fixtures/types.js';

/**
 * Database assertions over the existing Kysely worker fixture.
 *
 * WHY — "the UI said 200 and no row was written" is the exact class of defect a
 * black-box suite cannot see, and the `db` fixture has existed all along with
 * no step reading it. A far-side check is the only way to catch a silent
 * success.
 *
 * DESIGN — READ ONLY. There is deliberately no step that INSERTs or UPDATEs.
 * Seeding through the database rather than the application is how a suite comes
 * to assert against states the product cannot actually produce, and the rows it
 * writes then outlive the scenario. Seed through the API; assert through here.
 *
 * The table and column names a scenario passes are validated against a strict
 * identifier pattern before they reach the query builder. Kysely parameterises
 * VALUES, but an identifier is not a parameter — it is interpolated — so a
 * table name taken from a Gherkin string is an injection point unless it is
 * checked. Rejecting anything that is not a plain identifier is a smaller
 * surface than trying to escape it.
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const scopesOf = (
  apiContext: { vars: { toObject(): Record<string, unknown> } },
  env: { vars: Record<string, unknown> },
) => [apiContext.vars.toObject(), env.vars];

function requireDb(db: DbHandle | undefined): DbHandle {
  if (!db) {
    throw new SdodsError('DB_REQUIRED', 'This scenario needs a database connection.', {
      hint: 'Declare `db:` in the environment yaml. The db fixture is undefined when no connection is configured, and a db assertion that silently passes without one is worthless.',
    });
  }
  return db;
}

export function identifier(kind: string, value: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new SdodsError('CONFIG_INVALID', `"${value}" is not a valid ${kind} name.`, {
      hint: 'Table and column names are interpolated into SQL, not parameterised, so only plain identifiers are accepted.',
    });
  }
  return value;
}

/** `a = 1, b = x` → [['a', '1'], ['b', 'x']]. Values stay parameterised. */
export function parseWhere(clause: string): Array<[string, string]> {
  return clause.split(',').map((part) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(part);
    if (!m) {
      throw new SdodsError('CONFIG_INVALID', `Cannot read "${part.trim()}" as a condition.`, {
        hint: 'Write conditions as `column = value`, separated by commas.',
      });
    }
    return [identifier('column', m[1]!), m[2]!.replace(/^["']|["']$/g, '')] as [string, string];
  });
}

type Queryable = {
  selectFrom: (table: string) => {
    selectAll: () => {
      where: (c: string, op: string, v: unknown) => unknown;
      execute: () => Promise<unknown[]>;
    };
  };
};

async function rowsWhere(
  db: DbHandle,
  table: string,
  clause: string,
): Promise<Record<string, unknown>[]> {
  const kysely = db as unknown as Queryable;
  let q = kysely.selectFrom(identifier('table', table)).selectAll() as {
    where: (c: string, op: string, v: unknown) => typeof q;
    execute: () => Promise<Record<string, unknown>[]>;
  };
  for (const [col, val] of parseWhere(clause)) q = q.where(col, '=', val);
  return q.execute();
}

/* ── assertions ───────────────────────────────────────────────────────── */

Then(
  'the {string} table should have {int} row(s) where {string}',
  async ({ db, apiContext, env }, table: string, count: number, clause: string) => {
    const scopes = scopesOf(apiContext, env);
    const rows = await rowsWhere(
      requireDb(db),
      render(table, ...scopes),
      render(clause, ...scopes),
    );
    expect(rows, `${table} where ${clause}`).toHaveLength(count);
  },
);

Then(
  'the {string} table should have a row where {string}',
  async ({ db, apiContext, env }, table: string, clause: string) => {
    const scopes = scopesOf(apiContext, env);
    const rows = await rowsWhere(
      requireDb(db),
      render(table, ...scopes),
      render(clause, ...scopes),
    );
    expect(rows.length, `${table} where ${clause}`).toBeGreaterThan(0);
  },
);

Then(
  'the {string} table should have no row where {string}',
  async ({ db, apiContext, env }, table: string, clause: string) => {
    const scopes = scopesOf(apiContext, env);
    const rows = await rowsWhere(
      requireDb(db),
      render(table, ...scopes),
      render(clause, ...scopes),
    );
    expect(rows, `${table} where ${clause}`).toHaveLength(0);
  },
);

Then(
  'the {string} column of the row where {string} in {string} should be {string}',
  async ({ db, apiContext, env }, column: string, clause: string, table: string, value: string) => {
    const scopes = scopesOf(apiContext, env);
    const rows = await rowsWhere(
      requireDb(db),
      render(table, ...scopes),
      render(clause, ...scopes),
    );
    if (rows.length !== 1) {
      throw new SdodsError(
        'CONFIG_INVALID',
        `Expected exactly one row in ${table} where ${clause}, found ${rows.length}.`,
        {
          hint: 'Narrow the condition. Asserting a column across several rows hides which one matched.',
        },
      );
    }
    expect(String(rows[0]![identifier('column', render(column, ...scopes))])).toBe(
      render(value, ...scopes),
    );
  },
);

/**
 * Polling variant. A write that the API acknowledges is often applied
 * asynchronously, and the alternative to this step is a sleep — which is either
 * too short (flaky) or too long (slow), and never right.
 */
When(
  'I wait for the {string} table to have a row where {string}',
  async ({ db, apiContext, env }, table: string, clause: string) => {
    const scopes = scopesOf(apiContext, env);
    const handle = requireDb(db);
    const t = render(table, ...scopes);
    const c = render(clause, ...scopes);
    await expect
      .poll(async () => (await rowsWhere(handle, t, c)).length, {
        message: `${t} never got a row where ${c}`,
      })
      .toBeGreaterThan(0);
  },
);
