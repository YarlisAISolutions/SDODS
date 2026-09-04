import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { newId } from '@sdods/contracts';
import { PROPOSALS_DIR, safeJoin } from './fs.js';

/**
 * Proposals are the ONLY write path for agents and MCP write tools: files land under
 * `proposals/<id>/files/<path>` with a manifest, and a person applies them.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';
export type ProposalFileOp = 'add' | 'modify' | 'delete';

export interface ProposalFile {
  path: string;
  op: ProposalFileOp;
  /** relative to the proposal dir; absent for delete */
  from?: string;
}

export interface ProposalManifest {
  id: string;
  role: string;
  project?: string;
  env?: string;
  createdAt: string;
  status: ProposalStatus;
  summary: string;
  costUsd?: number;
  model?: string;
  files: ProposalFile[];
  verification?: {
    ranScenarios?: string[];
    status?: 'passed' | 'failed' | 'not-run';
    notes?: string;
  };
  reviewedAt?: string;
  reviewedBy?: string;
  appliedTo?: string;
}

export interface CreateProposalInput {
  role: string;
  project?: string;
  env?: string;
  summary: string;
  files: Array<{ path: string; content?: string; op?: ProposalFileOp }>;
  costUsd?: number;
  model?: string;
  verification?: ProposalManifest['verification'];
}

export class ProposalStore {
  readonly dir: string;

  constructor(readonly rootDir: string) {
    this.dir = resolve(rootDir, PROPOSALS_DIR);
  }

  private manifestPath(id: string): string {
    return join(this.dir, id, 'manifest.json');
  }

  create(input: CreateProposalInput): ProposalManifest {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..*/, '')
      .replace('T', '-');
    const id = `${stamp}-${input.role}-${newId().slice(-6)}`;
    const pdir = join(this.dir, id);
    mkdirSync(join(pdir, 'files'), { recursive: true });
    const files: ProposalFile[] = [];
    for (const f of input.files) {
      const op: ProposalFileOp =
        f.op ?? (existsSync(resolve(this.rootDir, f.path)) ? 'modify' : 'add');
      // validate the target path stays inside the repo
      safeJoin(this.rootDir, f.path);
      if (op === 'delete') {
        files.push({ path: f.path, op });
        continue;
      }
      const target = safeJoin(join(pdir, 'files'), f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content ?? '');
      files.push({ path: f.path, op, from: `files/${f.path}` });
    }
    const manifest: ProposalManifest = {
      id,
      role: input.role,
      project: input.project,
      env: input.env,
      createdAt: new Date().toISOString(),
      status: 'pending',
      summary: input.summary,
      costUsd: input.costUsd,
      model: input.model,
      files,
      verification: input.verification ?? { status: 'not-run' },
    };
    writeFileSync(this.manifestPath(id), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  list(filter: { status?: ProposalStatus; project?: string } = {}): ProposalManifest[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((id) => existsSync(this.manifestPath(id)))
      .map((id) => this.get(id))
      .filter((m): m is ProposalManifest => Boolean(m))
      .filter((m) => (filter.status ? m.status === filter.status : true))
      .filter((m) => (filter.project ? m.project === filter.project : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): ProposalManifest | undefined {
    const p = this.manifestPath(id);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, 'utf8')) as ProposalManifest;
  }

  readFile(id: string, file: ProposalFile): string | undefined {
    if (!file.from) return undefined;
    const p = safeJoin(join(this.dir, id), file.from);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  }

  /** Unified-ish diff for review (no external dependency). */
  diff(id: string): string {
    const m = this.get(id);
    if (!m) throw new Error(`Unknown proposal ${id}`);
    const parts: string[] = [];
    for (const f of m.files) {
      const target = resolve(this.rootDir, f.path);
      const before = f.op !== 'add' && existsSync(target) ? readFileSync(target, 'utf8') : '';
      const after = f.op === 'delete' ? '' : (this.readFile(id, f) ?? '');
      parts.push(
        `--- ${f.op === 'add' ? '/dev/null' : `a/${f.path}`}\n+++ ${f.op === 'delete' ? '/dev/null' : `b/${f.path}`}`,
      );
      parts.push(simpleDiff(before, after));
    }
    return parts.join('\n');
  }

  /** Apply to `targetRoot` (default: the repo). Returns the written paths. */
  accept(id: string, opts: { targetRoot?: string; reviewedBy?: string } = {}): string[] {
    const m = this.get(id);
    if (!m) throw new Error(`Unknown proposal ${id}`);
    if (m.status === 'rejected') throw new Error(`Proposal ${id} was rejected`);
    const root = opts.targetRoot ?? this.rootDir;
    const written: string[] = [];
    for (const f of m.files) {
      const target = safeJoin(root, f.path);
      if (f.op === 'delete') {
        if (existsSync(target)) rmSync(target);
        written.push(f.path);
        continue;
      }
      const src = safeJoin(join(this.dir, id), f.from!);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(src, target);
      written.push(f.path);
    }
    m.status = 'accepted';
    m.reviewedAt = new Date().toISOString();
    m.reviewedBy = opts.reviewedBy;
    m.appliedTo = relative(this.rootDir, root) || '.';
    writeFileSync(this.manifestPath(id), JSON.stringify(m, null, 2));
    return written;
  }

  reject(id: string, reason?: string, reviewedBy?: string): ProposalManifest {
    const m = this.get(id);
    if (!m) throw new Error(`Unknown proposal ${id}`);
    m.status = 'rejected';
    m.reviewedAt = new Date().toISOString();
    m.reviewedBy = reviewedBy;
    m.verification = { ...(m.verification ?? {}), notes: reason ?? m.verification?.notes };
    writeFileSync(this.manifestPath(id), JSON.stringify(m, null, 2));
    return m;
  }

  sizeOf(id: string): number {
    const dir = join(this.dir, id, 'files');
    if (!existsSync(dir)) return 0;
    let total = 0;
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of readdirSync(cur)) {
        const p = join(cur, n);
        const st = statSync(p);
        if (st.isDirectory()) stack.push(p);
        else total += st.size;
      }
    }
    return total;
  }
}

/** Line-based diff with +/- markers (LCS on lines, adequate for review output). */
export function simpleDiff(before: string, after: string): string {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`-${a[i]}`);
      i++;
    } else {
      out.push(`+${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`-${a[i++]}`);
  while (j < m) out.push(`+${b[j++]}`);
  return out.join('\n');
}
