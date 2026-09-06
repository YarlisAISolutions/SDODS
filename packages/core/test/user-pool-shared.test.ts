import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileUserPool } from '../src/data/user-pool.js';
import { CompositeDataProvider } from '../src/data/provider.js';
import { resolveConfig } from '../src/config/resolve.js';

/**
 * Exclusive leasing is right when scenarios mutate user-scoped state, and wrong
 * when they do not.
 *
 * With one account per role it serialises every scenario of that role behind a
 * single lease, so a parallel read-only suite spends its time waiting and then
 * fails on the timeout. Measured on a real suite: 23 of 53 failures were this,
 * and none of them was a defect in the application under test.
 */

function workspace(mode: 'exclusive' | 'shared', users: string[][]) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-pool-'));
  const projectRoot = join(root, 'projects', 'demo');
  mkdirSync(join(projectRoot, 'envs'), { recursive: true });
  mkdirSync(join(projectRoot, 'data', 'common'), { recursive: true });

  writeFileSync(
    join(root, 'sdods.workspace.yaml'),
    'organization:\n  slug: t\n  name: T\nworkspaces:\n  - slug: default\n    name: D\n    organization: t\ndefaultWorkspace: default\n',
  );
  writeFileSync(
    join(projectRoot, 'sdods.project.yaml'),
    [
      'slug: demo',
      'name: Demo',
      'organization: t',
      'workspace: default',
      'layers: [api]',
      'envs:',
      '  default: staging',
      '  available: [staging]',
      'data:',
      '  sources:',
      '    users: { type: csv, path: data/common/users.csv }',
      '  userPool:',
      '    dataset: users',
      '    roleColumn: role',
      `    mode: ${mode}`,
      '    waitMs: 1000',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(projectRoot, 'envs', 'staging.yaml'),
    'name: staging\nui:\n  baseUrl: https://example.test\napi:\n  baseUrl: https://api.example.test\n  auth: { type: none }\n',
  );
  writeFileSync(
    join(projectRoot, 'data', 'common', 'users.csv'),
    ['id,username,password,role', ...users.map((u) => u.join(','))].join('\n') + '\n',
  );

  return resolveConfig({ rootDir: root, projectRoot, env: 'staging', processEnv: {} });
}

function pool(config: ReturnType<typeof resolveConfig>, opts: { owner: string; waitMs?: number }) {
  return new FileUserPool(config, new CompositeDataProvider(config), opts);
}

const ONE_VIEWER = [['1', 'viewer@example.test', 'x', 'viewer']];

describe('shared mode lets one account serve every worker', () => {
  it('hands the same single account to two concurrent workers', async () => {
    const config = workspace('shared', ONE_VIEWER);
    const a = pool(config, { owner: 'worker-0' });
    const b = pool(config, { owner: 'worker-1' });

    const ua = await a.lease('viewer', 0);
    const ub = await b.lease('viewer', 1);

    expect(ua.username).toBe('viewer@example.test');
    expect(ub.username).toBe('viewer@example.test');
  });

  it('spreads workers across accounts when the pool has more than one', async () => {
    // Sharing must not mean "always account zero" — with capacity available,
    // spreading keeps rate limits and per-user state from concentrating.
    const config = workspace('shared', [
      ['1', 'v1@example.test', 'x', 'viewer'],
      ['2', 'v2@example.test', 'x', 'viewer'],
    ]);
    const a = await pool(config, { owner: 'w0' }).lease('viewer', 0);
    const b = await pool(config, { owner: 'w1' }).lease('viewer', 1);
    expect(a.username).not.toBe(b.username);
  });

  it('takes no lease, so releasing cannot disturb another worker', async () => {
    const config = workspace('shared', ONE_VIEWER);
    const p0 = pool(config, { owner: 'w0' });
    const user = await p0.lease('viewer', 0);

    expect(user.leaseKey).toBe('');
    await expect(p0.release(user)).resolves.toBeUndefined();

    // Still available afterwards — nothing was consumed.
    const again = await pool(config, { owner: 'w1' }).lease('viewer', 0);
    expect(again.username).toBe('viewer@example.test');
  });
});

describe('exclusive mode still serialises, and says how to escape it', () => {
  it('refuses a second worker once the only account is leased', async () => {
    const config = workspace('exclusive', ONE_VIEWER);
    const first = pool(config, { owner: 'w0' });
    await first.lease('viewer', 0);

    const second = pool(config, { owner: 'w1', waitMs: 50 });
    await expect(second.lease('viewer', 1)).rejects.toThrow(/are leased/);
  });

  it('the failure names shared mode as the first remedy', async () => {
    // The old hint offered only "add users or lower --workers", which is the
    // wrong advice for a read-only suite: the pool model was the problem, not
    // its size. An error that misdirects costs more than a terse one.
    const config = workspace('exclusive', ONE_VIEWER);
    await pool(config, { owner: 'w0' }).lease('viewer', 0);

    let hint = '';
    try {
      await pool(config, { owner: 'w1', waitMs: 50 }).lease('viewer', 1);
    } catch (e) {
      hint = String((e as { hint?: string }).hint ?? '');
    }
    expect(hint).toContain('mode: shared');
    expect(hint).toContain('poolSize slices the dataset BEFORE role filtering');
  });

  it('honours a configured waitMs instead of a hard-coded 30s', async () => {
    const config = workspace('exclusive', ONE_VIEWER);
    await pool(config, { owner: 'w0' }).lease('viewer', 0);

    const started = Date.now();
    await expect(pool(config, { owner: 'w1' }).lease('viewer', 1)).rejects.toThrow(/are leased/);
    const waited = Date.now() - started;

    // The project sets waitMs: 1000. If the hard-coded 30s were still in force
    // this would take thirty times as long.
    expect(waited).toBeLessThan(5_000);
  });
});
