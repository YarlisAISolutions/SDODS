import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/analyze/index.js';

/**
 * Four defects reproduced against a real Next.js monorepo, all of which made
 * `sdods analyze` produce a project proposal that could not be committed.
 *
 * They share a failure mode: the analyzer reported something PLAUSIBLE. A route
 * list full of confident wrong entries reads like a working feature, so the
 * proposal gets applied and the wrongness is discovered later, in the generated
 * `routes:` map, as addresses that resolve to nothing.
 */

function app(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-analyze-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'x', dependencies: { next: '16.0.0', react: '19.0.0' } }),
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const PAGE = 'export default function P() { return null }\n';
const ROUTE = 'export async function GET() {}\nexport async function DELETE() {}\n';

describe('a `pages` directory inside `app/` is not the Pages Router', () => {
  // The observed failure: `app/api/intranet/pages/[id]/route.ts` was reported
  // as a Pages Router PAGE at `/{id}/route` — wrong kind, wrong source, and a
  // path that had lost every parent segment. The old regex matched any
  // directory named `pages` anywhere in the tree.
  it('classifies a route handler under app/**/pages/ as an App Router API', () => {
    const root = app({ 'app/api/intranet/pages/[id]/route.ts': ROUTE });
    const routes = analyzeProject(root).routes;

    expect(routes.some((r) => r.source === 'next-pages-router')).toBe(false);

    const api = routes.filter((r) => r.kind === 'api');
    expect(api.length).toBeGreaterThan(0);
    for (const r of api) {
      expect(r.source).toBe('next-app-router');
      // The full address, not just the last segment before the filename.
      expect(r.path).toBe('/api/intranet/pages/{id}');
      expect(r.path).not.toMatch(/\/route$/);
    }
  });

  it('still detects a real Pages Router app', () => {
    // The guard must not throw out the feature it is narrowing.
    const root = app({ 'pages/about.tsx': PAGE, 'pages/api/ping.ts': ROUTE });
    const routes = analyzeProject(root).routes;
    const paths = routes.map((r) => r.path);
    expect(paths).toContain('/about');
    expect(routes.find((r) => r.path === '/about')!.source).toBe('next-pages-router');
    expect(routes.some((r) => r.path === '/api/ping' && r.kind === 'api')).toBe(true);
  });
});

describe('colocated tests and stories are not routes', () => {
  // The originally observed symptom — `route.test.ts` reported as the route
  // `id-publish-route-test` — turned out to be the pages-router bug above:
  // the App Router pattern requires `(page|route).<ext>` at the END, so
  // `route.test.ts` never matched it. The Pages Router is where a colocated
  // file really does become a route, because ANY filename under `pages/` is
  // one. That is what this pins.
  it('ignores colocated tests and stories under pages/', () => {
    const root = app({
      'pages/about.tsx': PAGE,
      'pages/about.test.tsx': PAGE,
      'pages/about.stories.tsx': PAGE,
      'pages/types.d.ts': 'export {}\n',
    });
    const routes = analyzeProject(root).routes;
    const paths = routes.map((r) => r.path);

    expect(paths).toContain('/about');
    expect(paths).not.toContain('/about.test');
    expect(paths).not.toContain('/about.stories');
    expect(paths).not.toContain('/types.d');
    expect(routes.map((r) => r.file).some((f) => /\.(test|stories|d)\./.test(f))).toBe(false);
  });
});

describe('a nested repository is never scanned', () => {
  // Observed: every one of 157 routes was cited inside
  // `.claude/worktrees/<branch>/`, a stale worktree of the same repo — and a
  // path that repo's own .gitignore excludes.
  it('does not descend into a directory holding its own .git', () => {
    const root = app({
      'app/real/page.tsx': PAGE,
      // A git worktree: `.git` is a FILE pointing at the parent repo.
      '.claude/worktrees/branch-a/.git': 'gitdir: /elsewhere/.git/worktrees/branch-a\n',
      '.claude/worktrees/branch-a/app/stale/page.tsx': PAGE,
      // A vendored clone: `.git` is a directory.
      'vendored/other-repo/.git/HEAD': 'ref: refs/heads/main\n',
      'vendored/other-repo/app/foreign/page.tsx': PAGE,
    });
    const files = analyzeProject(root).routes.map((r) => r.file);

    expect(files).toContain('app/real/page.tsx');
    expect(files.some((f) => f.includes('worktrees'))).toBe(false);
    expect(files.some((f) => f.includes('other-repo'))).toBe(false);
  });
});
