import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/analyze/index.js';

/**
 * The A-series: seven defects that each made `sdods analyze` state something FALSE with
 * confidence, on a repository where the truth was available.
 *
 * They are grouped in one file because they share a shape worth naming — every one of them
 * produced a plausible answer rather than an error, so the proposal was applied and the
 * wrongness surfaced much later, as a `routes:` map that resolved to nothing or an API base URL
 * pointing at somebody else's service. The assertions below are therefore written against the
 * WRONG answer each defect used to give, not just against the right one: a test that only
 * asserts the correct value would still pass if the fix were reverted and the default happened
 * to be right for that fixture.
 */

function app(files: Record<string, string>, pkg?: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'sdods-aseries-'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(pkg ?? { name: 'x', dependencies: { next: '16.0.0', react: '19.0.0' } }),
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

describe('A7 — the API base URL is the most specific name, not the first one', () => {
  // `SIM_AGENT_API_URL` sat 39 lines above `NEXT_PUBLIC_API_URL` in the same file. First-wins
  // by file order handed the whole generated project a base URL belonging to a different
  // service, and every generated API scenario then asserted against it.
  it('prefers NEXT_PUBLIC_API_URL over a service-prefixed sibling declared first', () => {
    const root = app({
      '.env.example': [
        'SIM_AGENT_API_URL=https://sim-agent.internal.example.com',
        'NEXT_PUBLIC_API_URL=https://api.example.com',
      ].join('\n'),
    });
    expect(analyzeProject(root).baseUrls.api).toBe('https://api.example.com');
  });

  it('keeps file order when two names are equally canonical', () => {
    const root = app({
      '.env.example': ['API_URL=https://first.example.com', 'API_BASE_URL=https://second.example.com'].join('\n'),
    });
    expect(analyzeProject(root).baseUrls.api).toBe('https://first.example.com');
  });
});

describe('A13 — an express dependency does not make the API origin equal the UI origin', () => {
  // The old branch set `api` unconditionally, which both invented `http://localhost:3000` when
  // no `.listen()` existed and suppressed the `api ??= ui + '/api'` fallback underneath it. The
  // result was api === ui with no suffix, so every generated API scenario hit the UI origin.
  it('falls through to ui + /api when the socket server shares the UI port', () => {
    const root = app(
      { 'server/socket.ts': 'server.listen(3000)\n', 'next.config.ts': 'export default {}\n' },
      { name: 'x', dependencies: { next: '16.0.0', express: '4.19.2' } },
    );
    const { baseUrls } = analyzeProject(root);
    expect(baseUrls.api).toBe(`${baseUrls.ui}/api`);
    expect(baseUrls.api).not.toBe(baseUrls.ui);
  });

  it('still trusts a listen() port that names a different origin', () => {
    const root = app(
      { 'server/api.ts': 'app.listen(4000)\n', 'next.config.ts': 'export default {}\n' },
      { name: 'x', dependencies: { next: '16.0.0', express: '4.19.2' } },
    );
    expect(analyzeProject(root).baseUrls.api).toBe('http://localhost:4000');
  });
});

describe('A14 — a gitignored .env is not read into the report', () => {
  // The file is deliberately untracked because it holds real credentials and real internal
  // hostnames. `analyze --json` output is pasted into issues and committed as generated yaml.
  it('skips .env.local when .gitignore excludes it, and says so', () => {
    const root = app({
      '.gitignore': '.env.local\n',
      '.env.local': 'NEXT_PUBLIC_API_URL=https://secret-internal.example.com\n',
      '.env.example': 'NEXT_PUBLIC_API_URL=https://api.example.com\n',
    });
    const report = analyzeProject(root);
    expect(JSON.stringify(report)).not.toContain('secret-internal.example.com');
    expect(report.envs.some((e) => e.file === '.env.local')).toBe(false);
    expect(report.baseUrls.api).toBe('https://api.example.com');
  });

  it('reads .env.local normally when it is not gitignored', () => {
    const root = app({ '.env.local': 'NEXT_PUBLIC_API_URL=https://api.example.com\n' });
    expect(analyzeProject(root).baseUrls.api).toBe('https://api.example.com');
  });
});

describe('A15 — a real environment outranks .env.example for base URLs', () => {
  // `propose` drops `example` from the env list because it is a template, not an environment.
  // Folding base URLs in file order meant the template could still supply them, so the proposal
  // named environments that had contributed none of their own values.
  it('takes base URLs from .env.staging even when .env.example sorts first', () => {
    const root = app({
      '.env.example': 'NEXT_PUBLIC_API_URL=https://placeholder.example.com\n',
      '.env.staging': 'NEXT_PUBLIC_API_URL=https://staging-api.example.com\n',
    });
    expect(analyzeProject(root).baseUrls.api).toBe('https://staging-api.example.com');
  });
});

describe('A9 — a workspace member resolves its package manager from the root above it', () => {
  // Scanning `apps/sat` is the normal monorepo case. The member has no lockfile and no
  // `workspaces` key, so the analyzer reported `unknown` / `monorepo: false` for a repo that
  // was plainly neither.
  it('finds the lockfile and the monorepo when scanning a member directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-ws-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['apps/*'], packageManager: 'bun@1.4.0' }),
    );
    writeFileSync(join(root, 'bun.lock'), '{}');
    const member = join(root, 'apps', 'sat');
    mkdirSync(member, { recursive: true });
    writeFileSync(join(member, 'package.json'), JSON.stringify({ name: '@x/sat' }));

    const pm = analyzeProject(member).packageManager;
    expect(pm.name).toBe('bun');
    expect(pm.monorepo).toBe(true);
  });
});

describe('A8 — an ambiguous auth guess is reported as ambiguous', () => {
  // The old loop resolved a tie by whichever key `Object.entries` yielded first, so a repo
  // scoring form and token identically got `form` for a reason no reader could see, and adding
  // one library could silently flip it.
  it('records the tie in evidence rather than picking silently', () => {
    // passport-local 0.8 + express-session 0.5 = form 1.3; jsonwebtoken 0.6 + @nestjs/jwt 0.7 = token 1.3
    const root = app({}, {
      name: 'x',
      dependencies: {
        'passport-local': '1.0.0',
        'express-session': '1.18.0',
        jsonwebtoken: '9.0.0',
        '@nestjs/jwt': '10.0.0',
      },
    });
    const auth = analyzeProject(root).auth;
    expect(auth.evidence.some((e) => e.snippet?.includes('ambiguous auth'))).toBe(true);
  });
});
