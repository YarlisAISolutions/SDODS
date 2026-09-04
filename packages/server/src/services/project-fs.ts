import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { PROJECT_FILE } from '@sdods/core/config';
import { forbidden, notFound } from '../errors.js';

const WRITABLE_DIRS = ['features', 'steps', 'pages', 'data', 'envs', 'recorded', 'har', 'schemas'];

/** Path-guarded file access inside one project directory. */
export class ProjectFs {
  constructor(readonly root: string) {}

  /** Resolve a relative path and refuse anything that escapes the project root. */
  resolve(rel: string): string {
    const abs = resolve(this.root, rel);
    const relBack = relative(this.root, abs);
    if (relBack.startsWith('..') || relBack.includes(`..${sep}`) || resolve(abs) !== abs)
      throw forbidden('Path escapes the project directory.');
    if (relBack.split(sep).includes('.auth') || relBack.startsWith('.env'))
      throw forbidden('Secrets are not accessible through the API.');
    return abs;
  }

  assertWritable(rel: string) {
    const abs = this.resolve(rel);
    const relBack = relative(this.root, abs);
    const top = relBack.split(sep)[0]!;
    if (relBack === PROJECT_FILE) return abs;
    if (!WRITABLE_DIRS.includes(top))
      throw forbidden(`Writes are limited to ${WRITABLE_DIRS.join(', ')} and ${PROJECT_FILE}.`);
    return abs;
  }

  read(rel: string): string {
    const abs = this.resolve(rel);
    if (!existsSync(abs) || statSync(abs).isDirectory()) throw notFound(`File ${rel}`);
    return readFileSync(abs, 'utf8');
  }

  write(rel: string, content: string) {
    const abs = this.assertWritable(rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }

  exists(rel: string): boolean {
    try {
      return existsSync(this.resolve(rel));
    } catch {
      return false;
    }
  }

  /** Recursive listing of files under a subdirectory (relative paths, posix separators). */
  tree(
    subdir: string,
    filter?: (rel: string) => boolean,
  ): Array<{ path: string; size: number; mtime: string }> {
    const base = this.resolve(subdir);
    if (!existsSync(base)) return [];
    const out: Array<{ path: string; size: number; mtime: string }> = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else {
          const rel = relative(this.root, abs).split(sep).join('/');
          if (!filter || filter(rel))
            out.push({ path: rel, size: st.size, mtime: st.mtime.toISOString() });
        }
      }
    };
    walk(base);
    return out;
  }

  /** Round-trip edit of a yaml file preserving comments. */
  updateYaml(rel: string, mutate: (doc: ReturnType<typeof parseDocument>) => void) {
    const abs = this.assertWritable(rel);
    const doc = parseDocument(existsSync(abs) ? readFileSync(abs, 'utf8') : '');
    mutate(doc);
    writeFileSync(abs, doc.toString({ lineWidth: 100 }));
  }
}
