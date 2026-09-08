import { describe, expect, it } from 'vitest';
import { resolveTime } from '../src/steps/clock.steps.js';
import { identifier, parseWhere } from '../src/steps/db.steps.js';

/**
 * The parts of the new step libraries that can be wrong WITHOUT a browser.
 *
 * Deliberately not "does the step click the thing" — that needs a page and is
 * covered by using it. What is asserted here is the logic a reader cannot check
 * by eye and that fails quietly when wrong: time arithmetic, and the identifier
 * guard standing between a Gherkin string and interpolated SQL.
 */

describe('clock — relative and absolute times', () => {
  const base = new Date('2026-01-15T12:00:00.000Z');

  it.each([
    ['+2 days', '2026-01-17T12:00:00.000Z'],
    ['+30 minutes', '2026-01-15T12:30:00.000Z'],
    ['-1 hour', '2026-01-15T11:00:00.000Z'],
    ['+1 week', '2026-01-22T12:00:00.000Z'],
    ['+45 seconds', '2026-01-15T12:00:45.000Z'],
  ])('reads %s', (spec, expected) => {
    expect(resolveTime(spec, base).toISOString()).toBe(expected);
  });

  it('accepts a singular unit as well as a plural', () => {
    expect(resolveTime('+1 day', base).toISOString()).toBe(
      resolveTime('+1 days', base).toISOString(),
    );
  });

  it('reads an absolute instant, ignoring the base', () => {
    expect(resolveTime('2027-06-01T00:00:00Z', base).toISOString()).toBe(
      '2027-06-01T00:00:00.000Z',
    );
  });

  it('refuses a time it cannot read, rather than defaulting to now', () => {
    // Silently returning `now` would make a trial-expiry scenario pass while
    // testing nothing, which is the whole failure mode this library exists to
    // remove.
    expect(() => resolveTime('next tuesday', base)).toThrow(/Cannot read/);
  });
});

describe('db — the identifier guard', () => {
  // Table and column names are interpolated into SQL, not parameterised. Kysely
  // will not save you here: a parameter placeholder cannot stand where an
  // identifier goes.
  it.each([
    'users; DROP TABLE users',
    'users--',
    '"users"',
    'public.users',
    'users WHERE 1=1',
    '',
    ' ',
  ])('rejects %j', (bad) => {
    expect(() => identifier('table', bad)).toThrow(/not a valid table name/);
  });

  it.each(['users', 'workflow_runs', '_internal', 'a1'])('accepts %j', (good) => {
    expect(identifier('table', good)).toBe(good);
  });
});

describe('db — condition parsing', () => {
  it('splits a comma-separated clause into column/value pairs', () => {
    expect(parseWhere('workspace_id = abc, status = active')).toEqual([
      ['workspace_id', 'abc'],
      ['status', 'active'],
    ]);
  });

  it('strips quotes from the value but not from the column', () => {
    expect(parseWhere("name = 'my workflow'")).toEqual([['name', 'my workflow']]);
  });

  it('runs the column name through the identifier guard', () => {
    expect(() => parseWhere('id; DROP TABLE t = 1')).toThrow();
  });

  it('refuses a clause it cannot read', () => {
    expect(() => parseWhere('workspace_id')).toThrow(/Cannot read/);
  });
});

describe('webhook — the receiver actually receives', () => {
  it('records method, path, headers and body of a real delivery', async () => {
    const { startReceiver } = await import('../src/steps/webhook.steps.js');
    const r = await startReceiver();
    try {
      const res = await fetch(`${r.url}/hooks/stripe?x=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': 'abc123' },
        body: JSON.stringify({ type: 'invoice.paid' }),
      });

      // 200 with an empty body matters: a provider that retries on a non-2xx
      // would deliver the same event repeatedly and every count assertion in
      // this library would then be meaningless.
      expect(res.status).toBe(200);

      expect(r.deliveries).toHaveLength(1);
      const d = r.deliveries[0]!;
      expect(d.method).toBe('POST');
      expect(d.path).toBe('/hooks/stripe?x=1');
      expect(d.headers['x-signature']).toBe('abc123');
      expect(JSON.parse(d.body)).toEqual({ type: 'invoice.paid' });
    } finally {
      await new Promise<void>((resolve) => r.server.close(() => resolve()));
    }
  });

  it('keeps deliveries in arrival order', async () => {
    const { startReceiver } = await import('../src/steps/webhook.steps.js');
    const r = await startReceiver();
    try {
      for (const n of [1, 2, 3]) {
        await fetch(r.url, { method: 'POST', body: String(n) });
      }
      expect(r.deliveries.map((d) => d.body)).toEqual(['1', '2', '3']);
    } finally {
      await new Promise<void>((resolve) => r.server.close(() => resolve()));
    }
  });

  it('binds an ephemeral port on loopback only', async () => {
    // Ephemeral because a fixed port collides across parallel workers;
    // loopback because a receiver bound to 0.0.0.0 on a CI runner is an open
    // endpoint on whatever network that runner is attached to.
    const { startReceiver } = await import('../src/steps/webhook.steps.js');
    const r = await startReceiver();
    try {
      expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(r.url).not.toMatch(/:0$/);
    } finally {
      await new Promise<void>((resolve) => r.server.close(() => resolve()));
    }
  });
});
