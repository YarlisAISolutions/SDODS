import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Issue #86: `sdods run` loads a project's `steps/auth.ts` through Playwright's TS loader, which
 * resolves `import './helper.js'` to `helper.ts` — the convention every step file follows.
 * `sdods auth capture` loaded the same file with a bare `import()`, i.e. Node's native type
 * stripping, which does not remap `.js` to `.ts`, so capture crashed with
 * "Cannot find module .../helper.js".
 *
 * Why a child process and a bundle: inside vitest, Vite resolves `.js` → `.ts` for TS importers and
 * rewrites dynamic `import()`, so an in-process test passes on the broken code and proves nothing.
 * Running from `src/` under `node --import tsx` hides it the same way (tsx is global there). The
 * published CLI runs compiled JS on plain `node`, so that is what this reproduces: capture.ts is
 * bundled to JS (third-party packages left external, resolved from @sdods/core's own
 * node_modules just like an install) and driven from a plain `node` process with no loader hooks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = resolve(here, '..');
const bundleDir = join(coreRoot, 'node_modules', '.cache', `auth-loader-test-${process.pid}`);
const bundle = join(bundleDir, 'capture.mjs');

beforeAll(async () => {
  mkdirSync(bundleDir, { recursive: true });
  const req = createRequire(createRequire(import.meta.url).resolve('tsx/package.json'));
  const esbuild = (await import(pathToFileURL(req.resolve('esbuild')).href)) as {
    build: (o: Record<string, unknown>) => Promise<unknown>;
  };
  await esbuild.build({
    entryPoints: [join(coreRoot, 'src', 'auth', 'capture.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [
      {
        name: 'externals',
        setup(build: {
          onResolve: (
            o: { filter: RegExp },
            cb: (a: {
              path: string;
              resolveDir: string;
            }) => { external: true; path?: string } | undefined,
          ) => void;
        }) {
          // Workspace packages export TypeScript, so they are bundled in; everything else is a
          // real npm dependency and stays an import, as in the published package. A dependency
          // of a bundled sibling package (e.g. @sdods/db → kysely) is not resolvable from
          // @sdods/core, so it is pinned to the file its own package resolves.
          build.onResolve({ filter: /^[^./]/ }, (a) => {
            if (a.path.startsWith('@sdods/') || a.path.startsWith('node:')) return undefined;
            if (a.resolveDir.startsWith(join(coreRoot, 'src'))) return { external: true };
            try {
              const file = createRequire(join(a.resolveDir, 'noop.js')).resolve(a.path);
              return { external: true, path: pathToFileURL(file).href };
            } catch {
              return { external: true };
            }
          });
        },
      },
    ],
  });
}, 60_000);

afterAll(() => rmSync(bundleDir, { recursive: true, force: true }));

function scaffold(opts: { moduleType: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'sdods-auth-loader-'));
  mkdirSync(join(root, 'steps'), { recursive: true });
  mkdirSync(join(root, 'data'), { recursive: true });
  if (opts.moduleType) writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(
    join(root, 'data', 'users.csv'),
    'id,username,password,role\n1,alice,pw,standard\n',
  );
  // The conventional `.js` specifier for a sibling TypeScript file, plus TS-only syntax.
  writeFileSync(
    join(root, 'steps', 'helper.ts'),
    `export enum Prefix { Token = 'tok' }\nexport const tokenFor = (name: string): string => \`\${Prefix.Token}-\${name}\`;\n`,
  );
  writeFileSync(
    join(root, 'steps', 'auth.ts'),
    [
      `import { tokenFor } from './helper.js';`,
      `export const auth = {`,
      `  strategy: 'custom' as const,`,
      `  login: async () => ({ cookies: [], origins: [] }),`,
      `  token: async ({ user }: { user: { username: string } }) => tokenFor(user.username),`,
      `};`,
      '',
    ].join('\n'),
  );
  return root;
}

function runCapture(root: string): { code: number; out: string } {
  const harness = join(bundleDir, `harness-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    harness,
    `
import { captureAuth } from ${JSON.stringify(pathToFileURL(bundle).href)};
const root = ${JSON.stringify(root)};
const config = {
  project: {
    root, slug: 'shop',
    auth: { strategy: 'custom', storageState: true, maxAgeMinutes: 60 },
    data: {
      sources: { users: { type: 'csv', path: 'data/users.csv' } },
      userPool: { dataset: 'users', roleColumn: 'role', leaseStore: 'file', leaseTtlMs: 1000 },
    },
  },
  env: { name: 'staging', ui: { baseUrl: 'https://shop.example.com' }, users: {}, vars: {} },
  runtime: { repoRoot: root, artifactsDir: root + '/.sdods/runs' },
};
const results = await captureAuth({
  config, role: 'standard', launch: async () => ({ close: async () => undefined }),
});
console.log(JSON.stringify(results));
`,
  );
  try {
    // Plain node: no --import tsx, no NODE_OPTIONS loader inherited from the test runner.
    const out = execFileSync(process.execPath, [harness], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('sdods auth capture loads steps/auth.ts like sdods run does (#86)', () => {
  it.each([
    ['a project with "type": "module"', true],
    ['a project with no package type (loaded as CommonJS by Playwright)', false],
  ])('resolves ./helper.js to helper.ts in %s', (_label, moduleType) => {
    const root = scaffold({ moduleType });
    const { code, out } = runCapture(root);
    expect(out).not.toMatch(/Cannot find module/);
    expect(code, out).toBe(0);
    const results = JSON.parse(out.trim().split('\n').pop()!) as Array<{
      strategy: string;
      tokenFile?: string;
    }>;
    // The strategy came from auth.ts (not the yaml fallback) and its helper really ran.
    expect(results).toHaveLength(1);
    expect(results[0]!.strategy).toBe('custom');
    expect(JSON.parse(readFileSync(results[0]!.tokenFile!, 'utf8')).token).toBe('tok-alice');
  });
});
