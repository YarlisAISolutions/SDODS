import { readFileSync } from 'node:fs';
import type { Octokit } from '@octokit/rest';
import type {
  EvidenceFile,
  IntegrationLogger,
  PublishedEvidence,
  SkippedEvidence,
} from './types.js';

/**
 * Issue evidence committed to a branch (#82). Screenshots in an issue render inline in a private
 * repository only when GitHub serves them to the reader's session; `blob/<branch>/<path>?raw=true`
 * does, release assets and Actions artifacts do not.
 *
 * Everything goes through the git data API, so no clone is needed:
 * - the branch is an orphan (a root commit with only a README) created on first use;
 * - one commit per run adds `runs/<runId>/<scenario>/<file>` and updates `runs/index.json` on top of
 *   the current head, and the ref moves with `force: false`. When another job moved it first, GitHub
 *   answers 422 (not a fast-forward); the tree and commit are rebuilt on the new head and retried.
 * - `prune` rewrites the branch as a new orphan commit holding only the runs to keep.
 *
 * Traces are never passed here: they carry credentials (#101).
 */

export const EVIDENCE_INDEX = 'runs/index.json';
/** The first line of the README the orphan branch is created with; prune requires it. */
const README_MARKER = '# SDODS evidence';
const README = `${README_MARKER}

Screenshots, videos and GIF previews linked from issues that SDODS opened for failing scenarios.
Files live under \`runs/<runId>/<scenario>/\`; \`runs/index.json\` records when each run was uploaded.

This branch is rewritten by \`sdods integrations evidence prune\`. Do not base work on it.
`;

export interface EvidenceIndex {
  runs: Record<string, { uploadedAt: string; project?: string; files: number; bytes: number }>;
}

export interface EvidenceCaps {
  maxFileBytes: number;
  maxRunBytes: number;
}

export interface GitHubBranchEvidenceOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
  /** web origin for links, e.g. `https://github.com` */
  serverUrl?: string;
  logger?: IntegrationLogger;
  /** bounded attempts for the ref update (default 5) */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** uploads log a reminder to prune when the branch holds runs older than this */
  retainDays?: number;
}

export interface PruneOptions {
  olderThanMs: number;
  dryRun?: boolean;
}

export interface PruneResult {
  branch: string;
  removed: Array<{ runId: string; uploadedAt: string }>;
  kept: string[];
  /** run directories missing from `runs/index.json`; kept, since their age is unknown */
  unknown: string[];
  commitSha?: string;
  dryRun: boolean;
}

export interface EvidenceCheckResult {
  ok: boolean;
  detail: string;
}

const KIND_ORDER: Record<EvidenceFile['kind'], number> = { screenshot: 0, preview: 1, video: 2 };

/**
 * Apply the size caps. Screenshots go first, then GIF previews, then videos, so a few large
 * videos never crowd out the images that render inline.
 */
export function planEvidence(
  files: EvidenceFile[],
  caps: EvidenceCaps,
): { upload: EvidenceFile[]; skipped: SkippedEvidence[] } {
  const ordered = files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => KIND_ORDER[a.f.kind] - KIND_ORDER[b.f.kind] || a.i - b.i)
    .map(({ f }) => f);
  const upload: EvidenceFile[] = [];
  const skipped: SkippedEvidence[] = [];
  let total = 0;
  for (const f of ordered) {
    const base = { key: f.key, fingerprint: f.fingerprint, name: f.name, bytes: f.bytes };
    if (f.bytes > caps.maxFileBytes) {
      skipped.push({
        ...base,
        reason: `larger than evidence.maxFileBytes (${formatBytes(caps.maxFileBytes)})`,
      });
    } else if (total + f.bytes > caps.maxRunBytes) {
      skipped.push({
        ...base,
        reason: `evidence.maxRunBytes (${formatBytes(caps.maxRunBytes)}) reached for this run`,
      });
    } else {
      total += f.bytes;
      upload.push(f);
    }
  }
  return { upload, skipped };
}

export class GitHubBranchEvidence {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  private readonly octokit: Octokit;
  private readonly serverUrl: string;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  /** replaced per run with the integration context's logger */
  logger?: IntegrationLogger;
  private readonly retainDays?: number;

  constructor(opts: GitHubBranchEvidenceOptions) {
    this.octokit = opts.octokit;
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.serverUrl = (opts.serverUrl ?? 'https://github.com').replace(/\/+$/, '');
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => new Date());
    this.logger = opts.logger;
    this.retainDays = opts.retainDays;
  }

  get fullName(): string {
    return `${this.owner}/${this.repo}`;
  }

  /** A link that renders inline for anyone who can read the repository. */
  url(path: string): string {
    const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
    return `${this.serverUrl}/${this.owner}/${this.repo}/blob/${enc(this.branch)}/${enc(path)}?raw=true`;
  }

  /** Commit a run's files in one commit and return their links. Files over the caps are skipped. */
  async publishRun(
    run: { id: string; projectSlug?: string },
    files: EvidenceFile[],
    caps: EvidenceCaps,
  ): Promise<PublishedEvidence> {
    const { upload, skipped } = planEvidence(files, caps);
    const urls = new Map<string, string>();
    if (!upload.length) return { urls, skipped };

    // first, so a default branch or an empty repository fails with a clear message before any upload
    await this.assertNotDefaultBranch();
    await this.ensureBranch();
    const runDir = `runs/${safeSegment(run.id)}`;
    const entries: TreeEntry[] = [];
    let bytes = 0;
    // blobs are content-addressed: created once, reused by every retry of the commit
    for (const f of upload) {
      const path = `${runDir}/${safeSegment(f.scenarioDir)}/${safeSegment(f.name)}`;
      const { data } = await this.octokit.rest.git.createBlob({
        owner: this.owner,
        repo: this.repo,
        content: readFileSync(f.localPath).toString('base64'),
        encoding: 'base64',
      });
      entries.push({ path, mode: '100644', type: 'blob', sha: data.sha });
      urls.set(f.key, this.url(path));
      bytes += f.bytes;
    }

    const message = `evidence: run ${run.id} (${upload.length} file${upload.length === 1 ? '' : 's'})`;
    const commitSha = await this.commitWithRetry(async (head) => {
      const { data: commit } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: head,
      });
      const layout = await this.readLayout(commit.tree.sha);
      const index = layout.index;
      index.runs[safeSegment(run.id)] = {
        uploadedAt: this.now().toISOString(),
        project: run.projectSlug,
        files: upload.length,
        bytes,
      };
      const stale = this.staleRuns(index);
      if (stale)
        this.logger?.info(
          `github evidence: ${stale} run(s) on ${this.fullName}@${this.branch} are older than retainDays; run \`sdods integrations evidence prune\``,
        );
      const indexSha = await this.blob(`${JSON.stringify(index, null, 2)}\n`);
      const { data: tree } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: commit.tree.sha,
        tree: [...entries, { path: EVIDENCE_INDEX, mode: '100644', type: 'blob', sha: indexSha }],
      });
      const { data: created } = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message,
        tree: tree.sha,
        parents: [head],
      });
      return created.sha;
    });
    return { urls, skipped, commitSha };
  }

  private staleRuns(index: EvidenceIndex): number {
    if (!this.retainDays) return 0;
    const cutoff = this.now().getTime() - this.retainDays * 86_400_000;
    return Object.values(index.runs).filter((r) => Date.parse(r.uploadedAt) < cutoff).length;
  }

  /**
   * Build a commit on the current head and move the ref with `force: false`. A 422 means another
   * job moved the branch in between: re-read the head and rebuild, with backoff, a bounded number
   * of times.
   */
  private async commitWithRetry(build: (head: string) => Promise<string>): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const head = await this.ensureBranch();
      const sha = await build(head);
      try {
        await this.octokit.rest.git.updateRef({
          owner: this.owner,
          repo: this.repo,
          ref: `heads/${this.branch}`,
          sha,
          force: false,
        });
        return sha;
      } catch (e) {
        const status = statusOf(e);
        if ((status !== 422 && status !== 409) || attempt >= this.maxAttempts) {
          throw new Error(
            `github evidence: cannot update ${this.fullName}@${this.branch} after ${attempt} attempt(s): ${(e as Error).message}`,
            { cause: e },
          );
        }
        const wait = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
        this.logger?.debug(
          `github evidence: ${this.branch} moved (HTTP ${status}), retrying in ${wait}ms`,
        );
        await this.sleep(wait);
      }
    }
  }

  /** The branch head, creating the orphan branch when it does not exist. */
  async ensureBranch(): Promise<string> {
    const existing = await this.headSha();
    if (existing) return existing;
    const { data: tree } = await this.octokit.rest.git
      .createTree({
        owner: this.owner,
        repo: this.repo,
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: README }],
      })
      .catch((e: unknown) => {
        // the git data API cannot write to a repository without any commit
        if (statusOf(e) === 409) throw new Error(this.emptyRepoMessage(), { cause: e });
        throw e;
      });
    const { data: commit } = await this.octokit.rest.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: 'evidence: create the SDODS evidence branch',
      tree: tree.sha,
      parents: [],
    });
    try {
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${this.branch}`,
        sha: commit.sha,
      });
      this.logger?.info(`github evidence: created orphan branch ${this.fullName}@${this.branch}`);
      return commit.sha;
    } catch (e) {
      // another job created it first
      if (statusOf(e) !== 422) throw e;
      const head = await this.headSha();
      if (!head) throw e;
      return head;
    }
  }

  private defaultBranch?: Promise<string | undefined>;

  /** The repository's default branch, read once. */
  private async repoDefaultBranch(): Promise<string | undefined> {
    this.defaultBranch ??= this.octokit.rest.repos
      .get({ owner: this.owner, repo: this.repo })
      .then(({ data }) => (data as { default_branch?: string }).default_branch)
      .catch((e: unknown) => {
        this.defaultBranch = undefined;
        throw e;
      });
    return this.defaultBranch;
  }

  private defaultBranchMessage(): string {
    return `github evidence: ${this.fullName}@${this.branch} is the repository's default branch; evidence is committed to an orphan branch that \`evidence prune\` rewrites, so set integrations.github.evidence.branch to a branch of its own (default sdods-evidence)`;
  }

  /** Uploads and prune never touch the default branch: prune would erase its history. */
  private async assertNotDefaultBranch(): Promise<void> {
    if ((await this.repoDefaultBranch()) === this.branch)
      throw new Error(this.defaultBranchMessage());
  }

  /**
   * Prune force-rewrites the branch, so it only runs on a branch SDODS created: one whose root
   * README.md is the one written with the orphan commit.
   */
  private async assertCreatedBySdods(root: TreeEntry[]): Promise<void> {
    const readme = root.find((e) => e.path === 'README.md' && e.type === 'blob');
    let text = '';
    if (readme?.sha) {
      const { data } = await this.octokit.rest.git.getBlob({
        owner: this.owner,
        repo: this.repo,
        file_sha: readme.sha,
      });
      text = Buffer.from(data.content, 'base64').toString('utf8');
    }
    if (!text.startsWith(README_MARKER)) {
      throw new Error(
        `github evidence: refusing to prune ${this.fullName}@${this.branch}: it was not created by SDODS (its README.md does not start with "${README_MARKER}"), and prune replaces the branch with a new orphan commit, erasing its history. Point integrations.github.evidence.branch at a branch SDODS creates.`,
      );
    }
  }

  private async isEmptyRepo(): Promise<boolean> {
    try {
      await this.octokit.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        per_page: 1,
      });
      return false;
    } catch (e) {
      if (statusOf(e) === 409) return true;
      throw e;
    }
  }

  private emptyRepoMessage(): string {
    return `evidence repo ${this.fullName} is empty: create it with a README (any first commit) before using it`;
  }

  private async headSha(): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.branch}`,
      });
      return data.object.sha;
    } catch (e) {
      if (statusOf(e) === 404) return null;
      // GitHub answers 409 ("repository is empty"), not 404, for a ref of a repo without a commit
      if (statusOf(e) === 409) throw new Error(this.emptyRepoMessage(), { cause: e });
      throw e;
    }
  }

  private async blob(text: string): Promise<string> {
    const { data } = await this.octokit.rest.git.createBlob({
      owner: this.owner,
      repo: this.repo,
      content: Buffer.from(text).toString('base64'),
      encoding: 'base64',
    });
    return data.sha;
  }

  /** Root entries, `runs/` entries and the parsed index of a tree. */
  private async readLayout(rootTreeSha: string): Promise<{
    root: TreeEntry[];
    runs: TreeEntry[];
    index: EvidenceIndex;
  }> {
    const root = await this.listTree(rootTreeSha);
    const runsDir = root.find((e) => e.path === 'runs' && e.type === 'tree');
    const runs = runsDir?.sha ? await this.listTree(runsDir.sha) : [];
    const indexEntry = runs.find((e) => e.path === 'index.json' && e.type === 'blob');
    let index: EvidenceIndex = { runs: {} };
    if (indexEntry?.sha) {
      const { data } = await this.octokit.rest.git.getBlob({
        owner: this.owner,
        repo: this.repo,
        file_sha: indexEntry.sha,
      });
      try {
        const parsed = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
        if (parsed && typeof parsed.runs === 'object') index = parsed as EvidenceIndex;
      } catch {
        this.logger?.warn(`github evidence: ${EVIDENCE_INDEX} is not valid JSON; starting afresh`);
      }
    }
    return { root, runs, index };
  }

  private async listTree(sha: string): Promise<TreeEntry[]> {
    const { data } = await this.octokit.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: sha,
    });
    return data.tree.map((e) => ({
      path: e.path ?? '',
      mode: (e.mode ?? '100644') as TreeEntry['mode'],
      type: (e.type ?? 'blob') as TreeEntry['type'],
      sha: e.sha ?? '',
    }));
  }

  /**
   * Rewrite the branch as a new orphan commit without the runs uploaded before the cutoff.
   * Kept run directories are reused by tree sha, so nothing is uploaded again. Just before the
   * force update the head is compared with the one the new tree was built from, and the rewrite is
   * rebuilt when it moved. That narrows the race with a concurrent upload but cannot close it: a
   * force update has no compare-and-swap, so a run pushed between that check and the update is
   * lost. Prune when CI is quiet. GitHub garbage-collects the dropped objects later, and issues
   * that linked them stop rendering those images.
   */
  async prune(opts: PruneOptions): Promise<PruneResult> {
    await this.assertNotDefaultBranch();
    for (let attempt = 1; ; attempt++) {
      const head = await this.headSha();
      const result: PruneResult = {
        branch: `${this.fullName}@${this.branch}`,
        removed: [],
        kept: [],
        unknown: [],
        dryRun: Boolean(opts.dryRun),
      };
      if (!head) return result;
      const { data: commit } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: head,
      });
      const { root, runs, index } = await this.readLayout(commit.tree.sha);
      await this.assertCreatedBySdods(root);
      const cutoff = this.now().getTime() - opts.olderThanMs;
      const keptDirs: TreeEntry[] = [];
      for (const entry of runs) {
        if (entry.type !== 'tree') {
          // stray files next to the run directories stay; the index is rewritten below
          if (entry.path !== 'index.json') keptDirs.push(entry);
          continue;
        }
        const meta = index.runs[entry.path];
        if (!meta) {
          result.unknown.push(entry.path);
          keptDirs.push(entry);
        } else if (Date.parse(meta.uploadedAt) < cutoff) {
          result.removed.push({ runId: entry.path, uploadedAt: meta.uploadedAt });
        } else {
          result.kept.push(entry.path);
          keptDirs.push(entry);
        }
      }
      if (!result.removed.length || opts.dryRun) return result;

      const removed = new Set(result.removed.map((r) => r.runId));
      const nextIndex: EvidenceIndex = {
        runs: Object.fromEntries(Object.entries(index.runs).filter(([id]) => !removed.has(id))),
      };
      const indexSha = await this.blob(`${JSON.stringify(nextIndex, null, 2)}\n`);
      const { data: runsTree } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        tree: [...keptDirs, { path: 'index.json', mode: '100644', type: 'blob', sha: indexSha }],
      });
      const { data: rootTree } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        tree: [
          ...root.filter((e) => e.path !== 'runs'),
          { path: 'runs', mode: '040000', type: 'tree', sha: runsTree.sha },
        ],
      });
      const { data: orphan } = await this.octokit.rest.git.createCommit({
        owner: this.owner,
        repo: this.repo,
        message: `evidence: prune ${removed.size} run(s) uploaded before ${new Date(cutoff).toISOString()}`,
        tree: rootTree.sha,
        parents: [],
      });
      // a force update would silently drop a run committed since the head was read
      if ((await this.headSha()) !== head) {
        if (attempt >= this.maxAttempts)
          throw new Error(
            `github evidence: ${this.fullName}@${this.branch} kept moving during prune; try again`,
          );
        await this.sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${this.branch}`,
        sha: orphan.sha,
        force: true,
      });
      return { ...result, commitSha: orphan.sha };
    }
  }

  /**
   * For `sdods integrations test`: the token can push to the evidence repository, and the branch
   * exists or will be created on the first upload. Nothing is created here, except that a token
   * whose repository response has no `permissions` is checked by writing one unreferenced blob.
   */
  async check(issueRepoPrivate?: boolean): Promise<EvidenceCheckResult> {
    let repoData: {
      full_name: string;
      private: boolean;
      default_branch?: string;
      permissions?: { push?: boolean };
    };
    try {
      ({ data: repoData } = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      }));
    } catch (e) {
      return { ok: false, detail: `evidence repo ${this.fullName}: ${(e as Error).message}` };
    }
    if (repoData.default_branch === this.branch)
      return { ok: false, detail: this.defaultBranchMessage().replace(/^github evidence: /, '') };
    const push = repoData.permissions?.push;
    let writable: string;
    if (push === false) {
      return {
        ok: false,
        detail: `evidence repo ${this.fullName}: the token cannot push (evidence.host: branch needs contents: write)`,
      };
    } else if (push === true) {
      writable = 'writable';
    } else {
      try {
        await this.blob('sdods evidence write check\n');
        writable = 'writable (checked by writing a blob)';
      } catch (e) {
        return {
          ok: false,
          detail: `evidence repo ${this.fullName}: the token cannot write git objects (needs contents: write): ${(e as Error).message}`,
        };
      }
    }
    let branch: string;
    try {
      let head: string | null;
      try {
        head = await this.headSha();
      } catch (e) {
        if ((e as Error).message === this.emptyRepoMessage())
          return { ok: false, detail: this.emptyRepoMessage() };
        throw e;
      }
      if (!head && (await this.isEmptyRepo()))
        return { ok: false, detail: this.emptyRepoMessage() };
      branch = head
        ? `branch ${this.branch} exists`
        : `branch ${this.branch} will be created on the first upload`;
    } catch (e) {
      return {
        ok: false,
        detail: `evidence repo ${this.fullName}: cannot read branch ${this.branch}: ${(e as Error).message}`,
      };
    }
    const visibility =
      !repoData.private && issueRepoPrivate
        ? '; WARNING: the evidence repo is public, anyone can open the screenshots'
        : repoData.private && issueRepoPrivate === false
          ? '; the evidence repo is private, so readers of this public repo will not see the images'
          : '';
    return {
      ok: true,
      detail: `evidence ${this.fullName}@${this.branch} ${writable}, ${branch}${visibility}`,
    };
  }
}

interface TreeEntry {
  path: string;
  mode: '100644' | '100755' | '040000' | '160000' | '120000';
  type: 'blob' | 'tree' | 'commit';
  sha: string;
}

/**
 * `90min`, `36h`, `14d`, `2w` or a bare number of days → milliseconds. A bare `m` is refused: it
 * reads as months to some people and minutes to others, and `3m` meant as months prunes nearly
 * everything.
 */
export function parseAge(text: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(min|[a-z]*)\s*$/i.exec(text);
  const unit = (m?.[2] || 'd').toLowerCase();
  if (m && unit === 'm')
    throw new Error(
      `Cannot parse age "${text}": "m" is ambiguous: use ${m[1]}min for minutes or ${Math.round(Number(m[1]) * 30)}d for about ${m[1]} month(s)`,
    );
  const ms = { min: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
  if (!m || ms === undefined)
    throw new Error(`Cannot parse age "${text}" (use e.g. 90min, 36h, 14d, 2w)`);
  return Number(m[1]) * ms;
}

/** A path segment safe in a git tree and a URL. */
export function safeSegment(text: string): string {
  const s = text.replace(/[^\w.-]+/g, '-').replace(/^[.-]+|-+$/g, '');
  return s || 'x';
}

/** `runs/<id>/<scenario-slug>/`: readable, and unique through the fingerprint. */
export function scenarioSlug(scenarioName: string, fingerprint: string): string {
  const name = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  const fp = fingerprint.replace(/[^\w]+/g, '').slice(0, 10);
  return [name, fp].filter(Boolean).join('-') || 'scenario';
}

export function evidenceKey(fingerprint: string, relPath: string): string {
  return `${fingerprint} ${relPath}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}
