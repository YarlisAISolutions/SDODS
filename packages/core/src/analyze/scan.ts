import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve as resolvePath, sep } from 'node:path';

/** Directories never scanned (build output, dependencies, VCS, caches). */
export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'vendor',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
  '.sdods',
  'html-report',
  'playwright-report',
  'test-results',
  'storybook-static',
  '.angular',
  '.gradle',
  'bin',
  'obj',
]);

export const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.html',
  '.htm',
  '.json',
  '.yaml',
  '.yml',
  '.md',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rb',
  '.php',
  '.cs',
  '.feature',
  '.toml',
  '.xml',
  '.gradle',
  '.env',
  '.txt',
  '.cfg',
  '.ini',
]);

export interface ScanOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxDepth?: number;
}

export interface ScannedFile {
  /** path relative to the scan root, always with forward slashes */
  rel: string;
  abs: string;
  ext: string;
  size: number;
}

/**
 * Cheap file index over an application repository with lazy, cached reads.
 * Bounded by file count, size and depth so `sdods analyze` stays fast on large monorepos.
 */
export class Scan {
  readonly root: string;
  readonly files: ScannedFile[] = [];
  readonly truncated: boolean;
  private readonly contents = new Map<string, string>();
  private readonly byRel = new Map<string, ScannedFile>();

  constructor(root: string, opts: ScanOptions = {}) {
    this.root = resolvePath(root);
    const maxFiles = opts.maxFiles ?? 8000;
    const maxDepth = opts.maxDepth ?? 12;
    let truncated = false;
    const walk = (dir: string, depth: number) => {
      if (truncated || depth > maxDepth) return;
      let names: string[];
      try {
        names = readdirSync(dir).sort();
      } catch {
        return;
      }
      for (const name of names) {
        if (this.files.length >= maxFiles) {
          truncated = true;
          return;
        }
        const abs = join(dir, name);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          if (IGNORED_DIRS.has(name)) continue;
          walk(abs, depth + 1);
        } else if (st.isFile()) {
          const ext = extname(name).toLowerCase();
          const isEnv = name.startsWith('.env');
          const known =
            TEXT_EXTENSIONS.has(ext) || isEnv || name === 'Jenkinsfile' || name === 'Dockerfile';
          if (!known) continue;
          const rel = relative(this.root, abs).split(sep).join('/');
          const f: ScannedFile = { rel, abs, ext: isEnv ? '.env' : ext, size: st.size };
          this.files.push(f);
          this.byRel.set(rel, f);
        }
      }
    };
    walk(this.root, 0);
    this.truncated = truncated;
    this.maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  }

  private readonly maxFileBytes: number;

  has(rel: string): boolean {
    return this.byRel.has(rel) || existsSync(join(this.root, rel));
  }

  get(rel: string): ScannedFile | undefined {
    return this.byRel.get(rel);
  }

  /** Read a file (cached); returns '' for oversized or unreadable files. */
  read(rel: string): string {
    const cached = this.contents.get(rel);
    if (cached !== undefined) return cached;
    const f = this.byRel.get(rel);
    const abs = f?.abs ?? join(this.root, rel);
    let text = '';
    try {
      const size = f?.size ?? statSync(abs).size;
      if (size <= this.maxFileBytes) text = readFileSync(abs, 'utf8');
    } catch {
      text = '';
    }
    this.contents.set(rel, text);
    return text;
  }

  json<T = any>(rel: string): T | undefined {
    const text = this.read(rel);
    if (!text) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  /** Files whose relative path matches the predicate. */
  filter(pred: (f: ScannedFile) => boolean): ScannedFile[] {
    return this.files.filter(pred);
  }

  byExt(...exts: string[]): ScannedFile[] {
    const set = new Set(exts);
    return this.files.filter((f) => set.has(f.ext));
  }

  /** Lines of `rel` matching the regex, with 1-based line numbers. */
  grep(rel: string, re: RegExp): Array<{ line: number; text: string; match: RegExpMatchArray }> {
    const out: Array<{ line: number; text: string; match: RegExpMatchArray }> = [];
    const text = this.read(rel);
    if (!text) return out;
    const lines = text.split(/\r?\n/);
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const r = new RegExp(re.source, flags);
      let m: RegExpMatchArray | null;
      while ((m = r.exec(line)) !== null) {
        out.push({ line: i + 1, text: line, match: m });
        if (m[0].length === 0) r.lastIndex++;
      }
    }
    return out;
  }

  /** All package.json manifests in the tree (root first). */
  manifests(): Array<{ rel: string; json: any }> {
    const list = this.files
      .filter((f) => f.rel === 'package.json' || f.rel.endsWith('/package.json'))
      .map((f) => ({ rel: f.rel, json: this.json(f.rel) }))
      .filter((m) => m.json && typeof m.json === 'object');
    return list.sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
  }

  /** Merged dependency map across manifests (name → version). */
  dependencies(): Map<string, { version: string; manifest: string }> {
    const deps = new Map<string, { version: string; manifest: string }>();
    for (const { rel, json } of this.manifests()) {
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const block = json[key];
        if (block && typeof block === 'object') {
          for (const [name, version] of Object.entries(block)) {
            if (!deps.has(name)) deps.set(name, { version: String(version), manifest: rel });
          }
        }
      }
    }
    return deps;
  }
}
