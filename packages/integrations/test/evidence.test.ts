import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Octokit } from '@octokit/rest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitHubIntegrationSchema, type RunRecord } from '@sdods/contracts';
import { createIntegrationContext } from '../src/context.js';
import {
  GitHubBranchEvidence,
  parseAge,
  planEvidence,
  scenarioSlug,
  type EvidenceIndex,
} from '../src/evidence.js';
import { GifPreviewer, type CommandRunner } from '../src/gif.js';
import { GitHubProvider } from '../src/github.js';
import { createMemoryStore } from '../src/store.js';
import type {
  EvidenceFile,
  IntegrationLogger,
  RunSummaryInput,
  ScenarioSummary,
} from '../src/types.js';

/**
 * #82 part 2: evidence committed to an orphan branch through the git data API, so screenshots
 * render inline in private repositories. The fake below keeps real git objects (content-addressed
 * blobs, trees, commits and refs) and enforces fast-forward ref updates like GitHub does.
 */

const API = 'https://api.github.test';

type Entry = { path: string; mode: string; type: 'blob' | 'tree'; sha: string };
type Obj =
  | { type: 'blob'; content: Buffer }
  | { type: 'tree'; entries: Entry[] }
  | { type: 'commit'; tree: string; parents: string[]; message: string };

class FakeGit {
  objects = new Map<string, Obj>();
  refs = new Map<string, string>();
  calls: string[] = [];
  updates: Array<{ sha: string; force: boolean; status: number }> = [];
  repo: {
    full_name: string;
    private: boolean;
    default_branch?: string;
    permissions?: { push: boolean };
  } = {
    full_name: 'acme/shop',
    private: true,
    default_branch: 'main',
    permissions: { push: true },
  };
  blobWritesAllowed = true;
  /** a repository created without a README */
  empty = false;
  /** runs before a ref update is applied: simulates another CI job pushing first */
  beforeUpdate?: (attempt: number) => void;

  put(obj: Obj): string {
    const payload = obj.type === 'blob' ? obj.content.toString('base64') : JSON.stringify(obj);
    const sha = createHash('sha1').update(`${obj.type}:${payload}`).digest('hex');
    this.objects.set(sha, obj);
    return sha;
  }

  get<T extends Obj['type']>(sha: string, type: T): Extract<Obj, { type: T }> {
    const o = this.objects.get(sha);
    if (!o || o.type !== type) throw new Error(`no ${type} ${sha}`);
    return o as Extract<Obj, { type: T }>;
  }

  /** every blob under a tree, by full path */
  files(treeSha: string, prefix = ''): Map<string, { mode: string; sha: string }> {
    const out = new Map<string, { mode: string; sha: string }>();
    for (const e of this.get(treeSha, 'tree').entries) {
      if (e.type === 'tree')
        for (const [p, v] of this.files(e.sha, `${prefix}${e.path}/`)) out.set(p, v);
      else out.set(`${prefix}${e.path}`, { mode: e.mode, sha: e.sha });
    }
    return out;
  }

  build(files: Map<string, { mode: string; sha: string }>): string {
    const here: Entry[] = [];
    const dirs = new Map<string, Map<string, { mode: string; sha: string }>>();
    for (const [p, v] of files) {
      const [head, ...rest] = p.split('/');
      if (!rest.length) here.push({ path: head!, mode: v.mode, type: 'blob', sha: v.sha });
      else {
        if (!dirs.has(head!)) dirs.set(head!, new Map());
        dirs.get(head!)!.set(rest.join('/'), v);
      }
    }
    for (const [name, sub] of dirs)
      here.push({ path: name, mode: '040000', type: 'tree', sha: this.build(sub) });
    here.sort((a, b) => a.path.localeCompare(b.path));
    return this.put({ type: 'tree', entries: here });
  }

  createTree(body: {
    base_tree?: string;
    tree: Array<{
      path: string;
      mode: string;
      type: string;
      sha?: string | null;
      content?: string;
    }>;
  }): string {
    const files = body.base_tree ? this.files(body.base_tree) : new Map();
    for (const e of body.tree) {
      if (e.type === 'tree') {
        for (const [p, v] of this.files(e.sha!, `${e.path}/`)) files.set(p, v);
        continue;
      }
      const sha =
        e.sha ??
        (e.content != null ? this.put({ type: 'blob', content: Buffer.from(e.content) }) : null);
      if (sha === null) files.delete(e.path);
      else files.set(e.path, { mode: e.mode, sha });
    }
    return this.build(files);
  }

  isAncestor(ancestor: string, sha: string): boolean {
    if (ancestor === sha) return true;
    return this.get(sha, 'commit').parents.some((p) => this.isAncestor(ancestor, p));
  }

  /** a commit on top of the branch head, as another job would push */
  pushFiles(branch: string, add: Record<string, string>, index?: EvidenceIndex): string {
    const head = this.refs.get(branch)!;
    const base = this.get(head, 'commit').tree;
    const tree = this.createTree({
      base_tree: base,
      tree: [
        ...Object.entries(add).map(([path, text]) => ({
          path,
          mode: '100644',
          type: 'blob',
          content: text,
        })),
        ...(index
          ? [
              {
                path: 'runs/index.json',
                mode: '100644',
                type: 'blob',
                content: JSON.stringify(index),
              },
            ]
          : []),
      ],
    });
    const sha = this.put({ type: 'commit', tree, parents: [head], message: 'other job' });
    this.refs.set(branch, sha);
    return sha;
  }

  /** seed a branch with an orphan commit holding these files */
  seed(branch: string, files: Record<string, string>): string {
    const tree = this.createTree({
      tree: Object.entries(files).map(([path, content]) => ({
        path,
        mode: '100644',
        type: 'blob',
        content,
      })),
    });
    const sha = this.put({ type: 'commit', tree, parents: [], message: 'seed' });
    this.refs.set(branch, sha);
    return sha;
  }

  headFiles(branch: string): Map<string, string> {
    const commit = this.get(this.refs.get(branch)!, 'commit');
    const out = new Map<string, string>();
    for (const [p, v] of this.files(commit.tree))
      out.set(p, this.get(v.sha, 'blob').content.toString('utf8'));
    return out;
  }

  handlers(base = `${API}/repos/acme/shop`) {
    const call = (name: string) => this.calls.push(name);
    let updateAttempt = 0;
    const emptyRepo = () =>
      HttpResponse.json({ message: 'Git Repository is empty.' }, { status: 409 });
    return [
      http.get(base, () => HttpResponse.json(this.repo)),
      http.get(`${base}/commits`, () => (this.empty ? emptyRepo() : HttpResponse.json([{}]))),
      // the git data API refuses writes to a repository without a first commit
      ...['blobs', 'trees', 'commits'].map((kind) =>
        http.post(`${base}/git/${kind}`, () => (this.empty ? emptyRepo() : undefined)),
      ),
      http.get(`${base}/git/ref/*`, ({ request }) => {
        call('getRef');
        // GitHub answers 409, not 404, for any ref of a repository without a commit
        if (this.empty) return emptyRepo();
        const ref = decodeURIComponent(new URL(request.url).pathname.split('/git/ref/')[1]!);
        const branch = ref.replace(/^heads\//, '');
        const sha = this.refs.get(branch);
        if (!sha) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
        return HttpResponse.json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
      }),
      http.post(`${base}/git/refs`, async ({ request }) => {
        call('createRef');
        const body = (await request.json()) as { ref: string; sha: string };
        const branch = body.ref.replace(/^refs\/heads\//, '');
        if (this.refs.has(branch))
          return HttpResponse.json({ message: 'Reference already exists' }, { status: 422 });
        this.refs.set(branch, body.sha);
        return HttpResponse.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 });
      }),
      http.patch(`${base}/git/refs/*`, async ({ request }) => {
        call('updateRef');
        const ref = decodeURIComponent(new URL(request.url).pathname.split('/git/refs/')[1]!);
        const branch = ref.replace(/^heads\//, '');
        const body = (await request.json()) as { sha: string; force?: boolean };
        this.beforeUpdate?.(++updateAttempt);
        const head = this.refs.get(branch);
        if (!head)
          return HttpResponse.json({ message: 'Reference does not exist' }, { status: 422 });
        if (!body.force && !this.isAncestor(head, body.sha)) {
          this.updates.push({ sha: body.sha, force: false, status: 422 });
          return HttpResponse.json({ message: 'Update is not a fast forward' }, { status: 422 });
        }
        this.updates.push({ sha: body.sha, force: Boolean(body.force), status: 200 });
        this.refs.set(branch, body.sha);
        return HttpResponse.json({ ref: `refs/heads/${branch}`, object: { sha: body.sha } });
      }),
      http.post(`${base}/git/blobs`, async ({ request }) => {
        call('createBlob');
        if (!this.blobWritesAllowed)
          return HttpResponse.json(
            { message: 'Resource not accessible by integration' },
            { status: 403 },
          );
        const body = (await request.json()) as { content: string; encoding: string };
        const sha = this.put({ type: 'blob', content: Buffer.from(body.content, 'base64') });
        return HttpResponse.json({ sha }, { status: 201 });
      }),
      http.get(`${base}/git/blobs/:sha`, ({ params }) => {
        const b = this.get(String(params.sha), 'blob');
        return HttpResponse.json({
          sha: params.sha,
          content: b.content.toString('base64'),
          encoding: 'base64',
        });
      }),
      http.post(`${base}/git/trees`, async ({ request }) => {
        call('createTree');
        const sha = this.createTree((await request.json()) as never);
        return HttpResponse.json({ sha }, { status: 201 });
      }),
      http.get(`${base}/git/trees/:sha`, ({ params }) => {
        const t = this.get(String(params.sha), 'tree');
        return HttpResponse.json({ sha: params.sha, tree: t.entries, truncated: false });
      }),
      http.post(`${base}/git/commits`, async ({ request }) => {
        const body = (await request.json()) as { tree: string; parents: string[]; message: string };
        call(body.parents.length ? 'createCommit' : 'createRootCommit');
        const sha = this.put({ type: 'commit', ...body });
        return HttpResponse.json({ sha }, { status: 201 });
      }),
      http.get(`${base}/git/commits/:sha`, ({ params }) => {
        const c = this.get(String(params.sha), 'commit');
        return HttpResponse.json({
          sha: params.sha,
          tree: { sha: c.tree },
          parents: c.parents.map((sha) => ({ sha })),
          message: c.message,
        });
      }),
    ];
  }
}

let git = new FakeGit();
const issues: Array<{ title: string; body: string }> = [];
const server = setupServer();

function issueHandlers() {
  return [
    http.get(`${API}/search/issues`, () =>
      HttpResponse.json({ total_count: 0, incomplete_results: false, items: [] }),
    ),
    http.get(`${API}/repos/acme/shop/labels`, () => HttpResponse.json([{ name: 'sdods' }])),
    http.post(`${API}/repos/acme/shop/issues`, async ({ request }) => {
      const body = (await request.json()) as { title: string; body: string };
      issues.push(body);
      const number = 100 + issues.length;
      return HttpResponse.json(
        { number, html_url: `https://github.test/acme/shop/issues/${number}`, state: 'open' },
        { status: 201 },
      );
    }),
  ];
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  git = new FakeGit();
  issues.length = 0;
});
afterAll(() => server.close());

function useFake(...extra: Parameters<typeof server.use>) {
  server.use(...extra, ...issueHandlers(), ...git.handlers());
}

const noSleep = vi.fn(async (_ms: number) => {});

function recordingLogger() {
  const lines: Record<'info' | 'warn' | 'error' | 'debug', string[]> = {
    info: [],
    warn: [],
    error: [],
    debug: [],
  };
  const logger: IntegrationLogger = {
    info: (m) => lines.info.push(m),
    warn: (m) => lines.warn.push(m),
    error: (m) => lines.error.push(m),
    debug: (m) => lines.debug.push(m),
  };
  return { logger, lines };
}

/** a run directory with a failure screenshot, a video and a trace for each scenario */
function artifacts(sizes: { png?: number; webm?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdods-evidence-'));
  const write = (rel: string, bytes: number | string) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), typeof bytes === 'string' ? bytes : Buffer.alloc(bytes, 7));
  };
  for (const fp of ['fp-login', 'fp-cart']) {
    write(`shop/${fp}/r0/scenario-failure.png`, sizes.png ?? 100);
    write(`runner-output/${fp}/video.webm`, sizes.webm ?? 300);
    write(`runner-output/${fp}/trace.zip`, 'PK Cookie: __session=s3cr3t');
  }
  return dir;
}

const baseRun: RunRecord = {
  id: 'run-1',
  projectSlug: 'shop',
  env: 'staging',
  trigger: 'ci',
  status: 'failed',
  layers: ['ui'],
  browsers: ['chromium'],
};

function scenario(fp: string, name: string, over: Partial<ScenarioSummary> = {}): ScenarioSummary {
  return {
    fingerprint: fp,
    featureUri: 'features/ui/login.feature',
    featureName: 'Login',
    scenarioName: name,
    runnerProject: 'shop--ui--chromium',
    layer: 'ui',
    browser: 'chromium',
    suiteTag: '@smoke',
    tags: ['@ui', '@smoke'],
    status: 'failed',
    flaky: false,
    attemptsCount: 1,
    errorMessage: 'boom',
    steps: [{ index: 0, keyword: 'When', text: 'I log in', status: 'failed' }],
    screenshots: [{ relPath: `shop/${fp}/r0/scenario-failure.png`, phase: 'failure' }],
    videoPath: `runner-output/${fp}/video.webm`,
    tracePath: `runner-output/${fp}/trace.zip`,
    jiraKeys: [],
    githubIssues: [],
    ...over,
  };
}

function summary(artifactsDir: string, scenarios?: ScenarioSummary[]): RunSummaryInput {
  const failed = scenarios ?? [
    scenario('fp-login', 'Successful login'),
    scenario('fp-cart', 'Add to cart'),
  ];
  return {
    run: { ...baseRun, artifactsDir },
    totals: {
      total: failed.length,
      passed: 0,
      failed: failed.length,
      skipped: 0,
      timedOut: 0,
      flaky: 0,
      healed: 0,
      durationMs: 1000,
    },
    scenarios: failed,
    failed,
    flaky: [],
    passed: [],
  };
}

async function provider(
  evidence: Record<string, unknown> | undefined,
  opts: { runCommand?: CommandRunner } = {},
) {
  const p = new GitHubProvider({
    baseUrl: API,
    serverUrl: 'https://github.com',
    sleep: noSleep,
    runCommand:
      opts.runCommand ??
      (async () =>
        Promise.reject(Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }))),
  });
  const cfg = GitHubIntegrationSchema.parse({
    enabled: true,
    owner: 'acme',
    repo: 'shop',
    checkRun: false,
    prComment: false,
    createIssueOnFailure: 'always',
    ...(evidence ? { evidence } : {}),
  });
  await p.init(cfg, { token: 'ghp_test' });
  return p;
}

function expectNoRemoteTrace(body: string) {
  expect(body).not.toMatch(/https?:\/\/\S*trace[^\s)]*\.zip/);
  expect(body).not.toMatch(/\]\([^)]*trace[^)]*\)/);
}

const BLOB = 'https://github.com/acme/shop/blob/sdods-evidence/runs/run-1';
/** the first line of the README the orphan branch is created with */
const SDODS_README = '# SDODS evidence\n\nScreenshots, videos and GIF previews.\n';

describe('integrations.github.evidence config', () => {
  it('is off unless configured, with documented defaults when host is branch', () => {
    expect(GitHubIntegrationSchema.parse({}).evidence).toBeUndefined();
    expect(GitHubIntegrationSchema.parse({ evidence: { host: 'branch' } }).evidence).toEqual({
      host: 'branch',
      branch: 'sdods-evidence',
      maxFileBytes: 5 * 1024 * 1024,
      maxRunBytes: 25 * 1024 * 1024,
      retainDays: 14,
      gifPreview: true,
    });
    expect(() =>
      GitHubIntegrationSchema.parse({ evidence: { host: 'branch', repo: 'no-slash' } }),
    ).toThrow(/owner\/name/);
  });

  it('refuses a protected branch name as the evidence branch', () => {
    for (const branch of ['main', 'master', 'develop', 'trunk', 'gh-pages', 'Main'])
      expect(
        () => GitHubIntegrationSchema.parse({ evidence: { host: 'branch', branch } }),
        branch,
      ).toThrow(/rewritten by evidence prune/);
    expect(
      GitHubIntegrationSchema.parse({ evidence: { host: 'branch', branch: 'qa-evidence' } })
        .evidence?.branch,
    ).toBe('qa-evidence');
  });

  it('parses prune ages and builds readable, unique scenario directories', () => {
    expect(parseAge('14d')).toBe(14 * 86_400_000);
    expect(parseAge('36h')).toBe(36 * 3_600_000);
    expect(parseAge('2w')).toBe(14 * 86_400_000);
    expect(parseAge('7')).toBe(7 * 86_400_000);
    expect(() => parseAge('soon')).toThrow(/Cannot parse age/);
    expect(scenarioSlug('Checkout › pays with "Visa" (EU)', 'a1b2c3d4e5f6a7b8')).toBe(
      'checkout-pays-with-visa-eu-a1b2c3d4e5',
    );
  });
});

describe('GitHub issues with evidence.host: branch', () => {
  it('leaves the issue body unchanged and calls no git API when the host is off', async () => {
    useFake();
    const dir = artifacts();
    const ctx = () =>
      createIntegrationContext({
        store: createMemoryStore(),
        env: {} as never,
        publicUrl: 'https://sdods.test',
      });
    await (await provider(undefined)).onRunFinished(summary(dir), ctx());
    const withoutKey = issues.map((i) => i.body);
    issues.length = 0;
    await (await provider({ host: 'none' })).onRunFinished(summary(dir), ctx());
    expect(issues.map((i) => i.body)).toEqual(withoutKey);
    expect(git.calls).toEqual([]);
    expect(withoutKey[0]).toContain(
      '![failure](https://sdods.test/api/runs/run-1/files/shop/fp-login/r0/scenario-failure.png)',
    );
    expect(withoutKey[0]).not.toContain('blob/');
  });

  it('creates the orphan branch, commits the run once and embeds blob/<branch>/…?raw=true links', async () => {
    useFake();
    const dir = artifacts();
    const { logger } = recordingLogger();
    const p = await provider({ host: 'branch' });
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as never, logger });
    const res = await p.onRunFinished(summary(dir), ctx);
    expect(res.actions.map((a) => a.kind)).toEqual(['issue-created', 'issue-created']);

    // orphan: a root commit with only the README, then one commit for the whole run on top of it
    expect(git.calls.filter((c) => c === 'createRootCommit')).toHaveLength(1);
    expect(git.calls.filter((c) => c === 'createRef')).toHaveLength(1);
    expect(git.calls.filter((c) => c === 'createCommit')).toHaveLength(1);
    const head = git.get(git.refs.get('sdods-evidence')!, 'commit');
    expect(head.message).toBe('evidence: run run-1 (4 files)');
    const root = git.get(head.parents[0]!, 'commit');
    expect(root.parents).toEqual([]);
    expect([...git.files(root.tree).keys()]).toEqual(['README.md']);
    expect(git.updates).toEqual([expect.objectContaining({ force: false, status: 200 })]);

    const files = git.headFiles('sdods-evidence');
    expect([...files.keys()].sort()).toEqual([
      'README.md',
      'runs/index.json',
      'runs/run-1/add-to-cart-fpcart/scenario-failure.png',
      'runs/run-1/add-to-cart-fpcart/video.webm',
      'runs/run-1/successful-login-fplogin/scenario-failure.png',
      'runs/run-1/successful-login-fplogin/video.webm',
    ]);
    // the trace is never committed (#101)
    expect([...files.keys()].some((f) => f.includes('trace'))).toBe(false);
    const index = JSON.parse(files.get('runs/index.json')!) as EvidenceIndex;
    expect(index.runs['run-1']).toMatchObject({ project: 'shop', files: 4, bytes: 800 });

    const login = issues.find((i) => i.title.includes('Successful login'))!.body;
    expect(login).toContain(
      `- failure: ![failure](${BLOB}/successful-login-fplogin/scenario-failure.png?raw=true)`,
    );
    expect(login).toContain(`- Video: ${BLOB}/successful-login-fplogin/video.webm?raw=true`);
    expect(login).not.toContain('add-to-cart');
    expect(login).not.toContain('### Evidence not uploaded');
    expect(login).toContain('contains credentials');
    expectNoRemoteTrace(login);
  });

  it('uses the branch another job created while this one was creating it', async () => {
    useFake();
    const other = { sha: '' };
    server.use(
      http.post(`${API}/repos/acme/shop/git/refs`, () => {
        git.calls.push('createRef');
        other.sha = git.seed('sdods-evidence', { 'README.md': 'created by another job' });
        return HttpResponse.json({ message: 'Reference already exists' }, { status: 422 });
      }),
    );
    const p = await provider({ host: 'branch' });
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as never });
    await p.onRunFinished(summary(artifacts(), [scenario('fp-login', 'Successful login')]), ctx);
    const head = git.get(git.refs.get('sdods-evidence')!, 'commit');
    expect(head.parents).toEqual([other.sha]);
    expect(git.headFiles('sdods-evidence').get('README.md')).toBe('created by another job');
    expect(issues[0]!.body).toContain(
      `${BLOB}/successful-login-fplogin/scenario-failure.png?raw=true`,
    );
  });

  it('rebuilds the commit on the new head and retries when another job moved the branch (422)', async () => {
    git.seed('sdods-evidence', { 'README.md': 'x' });
    git.beforeUpdate = (attempt) => {
      if (attempt === 1)
        git.pushFiles(
          'sdods-evidence',
          { 'runs/run-0/other/scenario-failure.png': 'other job' },
          { runs: { 'run-0': { uploadedAt: new Date().toISOString(), files: 1, bytes: 9 } } },
        );
    };
    useFake();
    noSleep.mockClear();
    const { logger, lines } = recordingLogger();
    const p = await provider({ host: 'branch' });
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as never, logger });
    await p.onRunFinished(summary(artifacts()), ctx);

    expect(git.updates.map((u) => u.status)).toEqual([422, 200]);
    expect(noSleep).toHaveBeenCalledTimes(1);
    expect(lines.debug.join('\n')).toContain('retrying');
    const files = git.headFiles('sdods-evidence');
    // neither job's files are lost
    expect(files.has('runs/run-0/other/scenario-failure.png')).toBe(true);
    expect(files.has('runs/run-1/successful-login-fplogin/scenario-failure.png')).toBe(true);
    const index = JSON.parse(files.get('runs/index.json')!) as EvidenceIndex;
    expect(Object.keys(index.runs).sort()).toEqual(['run-0', 'run-1']);
    expect(lines.warn).toEqual([]);
  });

  it('gives up after bounded attempts and still creates the issue with the old links', async () => {
    git.seed('sdods-evidence', { 'README.md': 'x' });
    let n = 0;
    git.beforeUpdate = () => git.pushFiles('sdods-evidence', { [`busy/${++n}.txt`]: String(n) });
    useFake();
    const { logger, lines } = recordingLogger();
    const p = await provider({ host: 'branch' });
    const ctx = createIntegrationContext({
      store: createMemoryStore(),
      env: {} as never,
      logger,
      publicUrl: 'https://sdods.test',
    });
    const res = await p.onRunFinished(
      summary(artifacts(), [scenario('fp-login', 'Successful login')]),
      ctx,
    );
    expect(git.updates.map((u) => u.status)).toEqual([422, 422, 422, 422, 422]);
    expect(lines.warn.join('\n')).toMatch(/evidence upload .* failed.*after 5 attempt/);
    expect(res.actions[0]).toMatchObject({ kind: 'issue-created' });
    expect(issues[0]!.body).toContain(
      '![failure](https://sdods.test/api/runs/run-1/files/shop/fp-login/r0/scenario-failure.png)',
    );
    expect(issues[0]!.body).not.toContain('blob/');
  });

  it('skips files over maxFileBytes, stops at maxRunBytes and lists both in the issue', async () => {
    useFake();
    const dir = artifacts({ png: 400, webm: 2000 });
    const p = await provider({ host: 'branch', maxFileBytes: 1500, maxRunBytes: 1000 });
    const ctx = createIntegrationContext({
      store: createMemoryStore(),
      env: {} as never,
      publicUrl: 'https://sdods.test',
    });
    await p.onRunFinished(summary(dir), ctx);
    const files = [...git.headFiles('sdods-evidence').keys()];
    // screenshots first (400 + 400 fit in 1000); both videos are over the per-file cap
    expect(files.filter((f) => f.startsWith('runs/run-1/')).sort()).toEqual([
      'runs/run-1/add-to-cart-fpcart/scenario-failure.png',
      'runs/run-1/successful-login-fplogin/scenario-failure.png',
    ]);
    const body = issues.find((i) => i.title.includes('Successful login'))!.body;
    expect(body).toContain(
      `![failure](${BLOB}/successful-login-fplogin/scenario-failure.png?raw=true)`,
    );
    expect(body).toContain('### Evidence not uploaded');
    expect(body).toContain('- `video.webm` (2 KB): larger than evidence.maxFileBytes (1 KB)');
    // a skipped video falls back to the previous link
    expect(body).toContain(
      '- Video: https://sdods.test/api/runs/run-1/files/runner-output/fp-login/video.webm',
    );
  });

  it('plans the run cap in order: screenshots, then previews, then videos', () => {
    const f = (key: string, kind: EvidenceFile['kind'], bytes: number): EvidenceFile => ({
      key,
      fingerprint: 'fp',
      scenarioDir: 's',
      name: key,
      localPath: '/dev/null',
      kind,
      bytes,
    });
    const plan = planEvidence(
      [
        f('video', 'video', 50),
        f('shot1', 'screenshot', 40),
        f('gif', 'preview', 30),
        f('shot2', 'screenshot', 40),
      ],
      { maxFileBytes: 60, maxRunBytes: 100 },
    );
    expect(plan.upload.map((u) => u.key)).toEqual(['shot1', 'shot2']);
    expect(plan.skipped.map((s) => [s.key, s.reason])).toEqual([
      ['gif', 'evidence.maxRunBytes (100 B) reached for this run'],
      ['video', 'evidence.maxRunBytes (100 B) reached for this run'],
    ]);
  });

  it('embeds a GIF preview made by ffmpeg (injected runner)', async () => {
    useFake();
    const invocations: string[][] = [];
    const runner: CommandRunner = async (cmd, args) => {
      invocations.push([cmd, ...args]);
      if (args[0] !== '-version') writeFileSync(args.at(-1)!, 'GIF89a');
      return { code: 0 };
    };
    const p = await provider({ host: 'branch' }, { runCommand: runner });
    const ctx = createIntegrationContext({ store: createMemoryStore(), env: {} as never });
    await p.onRunFinished(summary(artifacts(), [scenario('fp-login', 'Successful login')]), ctx);

    expect(invocations[0]).toEqual(['ffmpeg', '-version']);
    const convert = invocations[1]!;
    expect(convert).toEqual(expect.arrayContaining(['-sseof', '-5', '-loop', '0']));
    expect(convert.join(' ')).toContain('fps=8,scale=480:-2');
    expect(convert[convert.indexOf('-i') + 1]).toMatch(/runner-output\/fp-login\/video\.webm$/);
    expect(invocations).toHaveLength(2);
    const files = git.headFiles('sdods-evidence');
    expect(files.get('runs/run-1/successful-login-fplogin/preview.gif')).toBe('GIF89a');
    expect(issues[0]!.body).toContain(
      `- Preview (last 5 s): ![video preview](${BLOB}/successful-login-fplogin/preview.gif?raw=true)`,
    );
  });

  it('skips the GIF silently, with a debug log, when ffmpeg is not on PATH', async () => {
    const { logger, lines } = recordingLogger();
    const missing: CommandRunner = async () => {
      throw Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
    };
    const gif = new GifPreviewer(missing);
    expect(await gif.make('/x/video.webm', '/x/out.gif', logger)).toBeNull();
    expect(lines.debug).toEqual([
      'github evidence: ffmpeg not found on PATH, skipping the GIF preview',
    ]);
    expect(lines.warn).toEqual([]);

    const failing = new GifPreviewer(async (_c, args) => ({
      code: args[0] === '-version' ? 0 : 1,
      stderr: 'Invalid data found when processing input',
    }));
    expect(await failing.make('/x/video.webm', '/x/out.gif', logger)).toBeNull();
    expect(lines.debug.at(-1)).toContain('exit 1');
  });
});

describe('sdods integrations test with evidence.host: branch', () => {
  it('reports a writable host and a branch to be created', async () => {
    useFake();
    const res = await (await provider({ host: 'branch' })).test();
    expect(res.ok).toBe(true);
    expect(res.evidence).toEqual({
      ok: true,
      detail:
        'evidence acme/shop@sdods-evidence writable, branch sdods-evidence will be created on the first upload',
    });
    expect(res.detail).toBe(`repo acme/shop reachable (private); ${res.evidence!.detail}`);
    expect(git.refs.size).toBe(0);
  });

  it('fails when the token cannot push', async () => {
    git.repo.permissions = { push: false };
    git.seed('sdods-evidence', { 'README.md': 'x' });
    useFake();
    const res = await (await provider({ host: 'branch' })).test();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain(
      'the token cannot push (evidence.host: branch needs contents: write)',
    );
  });

  it('checks a token without repository permissions by writing a blob, against a separate evidence repo', async () => {
    const evidenceRepo = new FakeGit();
    evidenceRepo.repo = { full_name: 'acme/evidence', private: false };
    evidenceRepo.seed('sdods-evidence', { 'README.md': 'x' });
    server.use(...evidenceRepo.handlers(`${API}/repos/acme/evidence`));
    useFake();
    const p = new GitHubProvider({ baseUrl: API });
    await p.init(
      GitHubIntegrationSchema.parse({
        enabled: true,
        owner: 'acme',
        repo: 'shop',
        evidence: { host: 'branch', repo: 'acme/evidence', tokenEnv: 'EVIDENCE_TOKEN' },
      }),
      { token: 'ghp_code', evidenceToken: 'ghp_evidence' },
    );
    const res = await p.test();
    expect(res.evidence).toEqual({
      ok: true,
      detail:
        'evidence acme/evidence@sdods-evidence writable (checked by writing a blob), branch sdods-evidence exists; WARNING: the evidence repo is public, anyone can open the screenshots',
    });
    expect(evidenceRepo.calls).toContain('createBlob');
    expect(git.calls).toEqual([]);

    evidenceRepo.blobWritesAllowed = false;
    const denied = await p.test();
    expect(denied.ok).toBe(false);
    expect(denied.detail).toContain('cannot write git objects (needs contents: write)');
  });

  it('reports an empty evidence repository, and issues fall back to the old links', async () => {
    git.empty = true;
    useFake();
    const p = await provider({ host: 'branch' });
    const res = await p.test();
    expect(res.evidence).toEqual({
      ok: false,
      detail:
        'evidence repo acme/shop is empty: create it with a README (any first commit) before using it',
    });
    const { logger, lines } = recordingLogger();
    await p.onRunFinished(
      summary(artifacts(), [scenario('fp-login', 'Successful login')]),
      createIntegrationContext({ store: createMemoryStore(), env: {} as never, logger }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.body).not.toContain('blob/');
    expect(lines.warn.join('\n')).toContain('is empty: create it with a README');
    expect(git.calls).not.toContain('createBlob');
    await expect(p.pruneEvidence({ dryRun: true })).rejects.toThrow(
      'evidence repo acme/shop is empty: create it with a README',
    );
  });

  it('reports a missing evidence token without breaking issue creation', async () => {
    useFake();
    const p = new GitHubProvider({ baseUrl: API });
    await p.init(
      GitHubIntegrationSchema.parse({
        enabled: true,
        owner: 'acme',
        repo: 'shop',
        createIssueOnFailure: 'always',
        checkRun: false,
        prComment: false,
        evidence: { host: 'branch', tokenEnv: 'EVIDENCE_TOKEN' },
      }),
      { token: 'ghp_code' },
    );
    const res = await p.test();
    expect(res).toMatchObject({
      ok: false,
      evidence: { ok: false, detail: 'evidence host needs a token in $EVIDENCE_TOKEN' },
    });
    const { logger, lines } = recordingLogger();
    await p.onRunFinished(
      summary(artifacts(), [scenario('fp-login', 'Successful login')]),
      createIntegrationContext({ store: createMemoryStore(), env: {} as never, logger }),
    );
    expect(issues).toHaveLength(1);
    expect(lines.warn.join('\n')).toContain('$EVIDENCE_TOKEN');
  });
});

describe('the evidence branch is never a branch people work on', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const old = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  function host() {
    return new GitHubBranchEvidence({
      octokit: new Octokit({ auth: 'ghp_test', baseUrl: API }),
      owner: 'acme',
      repo: 'shop',
      branch: 'sdods-evidence',
      now: () => now,
      sleep: noSleep,
    });
  }

  it('refuses to upload onto the repository default branch, and the issue keeps the old links', async () => {
    git.repo.default_branch = 'sdods-evidence';
    const before = git.seed('sdods-evidence', { 'README.md': '# Shop\n', 'src/app.ts': 'code' });
    useFake();
    const { logger, lines } = recordingLogger();
    const p = await provider({ host: 'branch' });
    await p.onRunFinished(
      summary(artifacts(), [scenario('fp-login', 'Successful login')]),
      createIntegrationContext({ store: createMemoryStore(), env: {} as never, logger }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.body).not.toContain('blob/');
    expect(lines.warn.join('\n')).toContain("is the repository's default branch");
    expect(git.refs.get('sdods-evidence')).toBe(before);
    expect(git.calls).not.toContain('createBlob');
  });

  it('sdods integrations test fails when the evidence branch is the default branch', async () => {
    git.repo.default_branch = 'sdods-evidence';
    git.seed('sdods-evidence', { 'README.md': '# Shop\n' });
    useFake();
    const res = await (await provider({ host: 'branch' })).test();
    expect(res.ok).toBe(false);
    expect(res.evidence?.detail).toContain("is the repository's default branch");
  });

  it('refuses to prune the default branch', async () => {
    git.repo.default_branch = 'sdods-evidence';
    const before = git.seed('sdods-evidence', {
      'README.md': SDODS_README,
      'runs/old-run/login/scenario-failure.png': 'old',
      'runs/index.json': JSON.stringify({
        runs: { 'old-run': { uploadedAt: old, files: 1, bytes: 3 } },
      }),
    });
    useFake();
    await expect(host().prune({ olderThanMs: parseAge('14d') })).rejects.toThrow(/default branch/);
    expect(git.refs.get('sdods-evidence')).toBe(before);
    expect(git.updates).toEqual([]);
  });

  it('refuses to prune a branch SDODS did not create, even one holding a runs index', async () => {
    // e.g. evidence.branch pointed at a release branch that uploads then committed onto
    const before = git.seed('sdods-evidence', {
      'README.md': '# Shop\n\nThe storefront.\n',
      'src/app.ts': 'code with years of history',
      'runs/old-run/login/scenario-failure.png': 'old',
      'runs/index.json': JSON.stringify({
        runs: { 'old-run': { uploadedAt: old, files: 1, bytes: 3 } },
      }),
    });
    useFake();
    for (const dryRun of [true, false])
      await expect(host().prune({ olderThanMs: parseAge('14d'), dryRun })).rejects.toThrow(
        /was not created by SDODS/,
      );
    expect(git.refs.get('sdods-evidence')).toBe(before);
    expect(git.updates).toEqual([]);
  });
});

describe('sdods integrations evidence prune', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  function seedRuns(
    daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString(),
  ) {
    git.seed('sdods-evidence', {
      'README.md': SDODS_README,
      'runs/old-run/login/scenario-failure.png': 'old',
      'runs/new-run/login/scenario-failure.png': 'new',
      'runs/stray-run/login/scenario-failure.png': 'unknown age',
      'runs/NOTES.md': 'a file someone added by hand',
      'runs/index.json': JSON.stringify({
        runs: {
          'old-run': { uploadedAt: daysAgo(20), files: 1, bytes: 3 },
          'new-run': { uploadedAt: daysAgo(2), files: 1, bytes: 3 },
        },
      }),
    });
  }

  function host(maxAttempts = 3) {
    return new GitHubBranchEvidence({
      octokit: new Octokit({ auth: 'ghp_test', baseUrl: API }),
      owner: 'acme',
      repo: 'shop',
      branch: 'sdods-evidence',
      now: () => now,
      sleep: noSleep,
      maxAttempts,
    });
  }

  it('rewrites the branch as a new orphan commit without runs older than the cutoff', async () => {
    seedRuns();
    const before = git.refs.get('sdods-evidence')!;
    useFake();
    const res = await host().prune({ olderThanMs: parseAge('14d') });
    expect(res.removed).toEqual([{ runId: 'old-run', uploadedAt: daysAgo(20) }]);
    expect(res.kept).toEqual(['new-run']);
    expect(res.unknown).toEqual(['stray-run']);

    const head = git.get(git.refs.get('sdods-evidence')!, 'commit');
    expect(head.parents).toEqual([]);
    expect(git.refs.get('sdods-evidence')).not.toBe(before);
    expect(git.updates).toEqual([expect.objectContaining({ force: true, status: 200 })]);
    const files = git.headFiles('sdods-evidence');
    expect([...files.keys()].sort()).toEqual([
      'README.md',
      'runs/NOTES.md',
      'runs/index.json',
      'runs/new-run/login/scenario-failure.png',
      'runs/stray-run/login/scenario-failure.png',
    ]);
    expect(Object.keys((JSON.parse(files.get('runs/index.json')!) as EvidenceIndex).runs)).toEqual([
      'new-run',
    ]);
    // kept runs are reused by tree sha: no file content is uploaded again
    expect(git.calls.filter((c) => c === 'createBlob')).toHaveLength(1);
  });

  it('writes nothing on --dry-run or when nothing is old enough', async () => {
    seedRuns();
    const before = git.refs.get('sdods-evidence');
    useFake();
    const dry = await host().prune({ olderThanMs: parseAge('14d'), dryRun: true });
    expect(dry.removed.map((r) => r.runId)).toEqual(['old-run']);
    const none = await host().prune({ olderThanMs: parseAge('30d') });
    expect(none.removed).toEqual([]);
    expect(git.refs.get('sdods-evidence')).toBe(before);
    expect(git.calls.filter((c) => /^create|update/.test(c))).toEqual([]);
  });

  it('rebuilds on the new head when a run lands during the prune', async () => {
    seedRuns();
    useFake();
    let raced = false;
    const h = host();
    const originalHandlers = git.calls;
    // push another run right after the orphan commit is created, before the ref check
    server.use(
      http.post(`${API}/repos/acme/shop/git/commits`, async ({ request }) => {
        const body = (await request.json()) as { tree: string; parents: string[]; message: string };
        originalHandlers.push(body.parents.length ? 'createCommit' : 'createRootCommit');
        const sha = git.put({ type: 'commit', ...body });
        if (!raced) {
          raced = true;
          git.pushFiles(
            'sdods-evidence',
            { 'runs/late-run/login/scenario-failure.png': 'late' },
            {
              runs: {
                'old-run': { uploadedAt: daysAgo(20), files: 1, bytes: 3 },
                'new-run': { uploadedAt: daysAgo(2), files: 1, bytes: 3 },
                'late-run': { uploadedAt: daysAgo(0), files: 1, bytes: 4 },
              },
            },
          );
        }
        return HttpResponse.json({ sha }, { status: 201 });
      }),
    );
    const res = await h.prune({ olderThanMs: parseAge('14d') });
    expect(res.kept.sort()).toEqual(['late-run', 'new-run']);
    const files = git.headFiles('sdods-evidence');
    expect(files.has('runs/late-run/login/scenario-failure.png')).toBe(true);
    expect(files.has('runs/old-run/login/scenario-failure.png')).toBe(false);
    expect(git.updates).toHaveLength(1);
  });

  it('prunes with retainDays by default through the provider', async () => {
    // the provider uses the real clock
    seedRuns((d) => new Date(Date.now() - d * 86_400_000).toISOString());
    useFake();
    const p = await provider({ host: 'branch', retainDays: 14 });
    expect((await p.pruneEvidence({ dryRun: true })).removed.map((r) => r.runId)).toEqual([
      'old-run',
    ]);
    expect(
      (await p.pruneEvidence({ olderThan: '1d', dryRun: true })).removed.map((r) => r.runId).sort(),
    ).toEqual(['new-run', 'old-run']);
    await expect((await provider(undefined)).pruneEvidence()).rejects.toThrow(/not "branch"/);
  });
});
