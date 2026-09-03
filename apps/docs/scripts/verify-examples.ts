/**
 * Extracts fenced code blocks whose info string contains `automax-verify` from the docs
 * and executes each non-comment line via `bun run automax ...` from the repository root.
 * Exits non-zero on the first failing command so the docs cannot drift from the CLI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const docsDir = resolve(import.meta.dirname, '..', 'content', 'docs');
const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.mdx?$/.test(f)) acc.push(p);
  }
  return acc;
}

interface Block {
  file: string;
  line: number;
  commands: string[];
}

function extract(file: string): Block[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const blocks: Block[] = [];
  let inBlock = false;
  let current: Block | null = null;
  lines.forEach((raw, i) => {
    const fence = /^```(.*)$/.exec(raw.trim());
    if (fence && !inBlock) {
      inBlock = true;
      current = fence[1]!.includes('automax-verify') ? { file, line: i + 1, commands: [] } : null;
      return;
    }
    if (fence && inBlock) {
      inBlock = false;
      if (current) blocks.push(current);
      current = null;
      return;
    }
    if (inBlock && current) {
      const cmd = raw.trim();
      if (cmd && !cmd.startsWith('#')) current.commands.push(cmd);
    }
  });
  return blocks;
}

const blocks = walk(docsDir).flatMap(extract);
if (blocks.length === 0) {
  console.log('docs:verify — no automax-verify blocks found');
  process.exit(0);
}
let failed = 0;
for (const b of blocks) {
  for (const cmd of b.commands) {
    const rel = b.file.replace(repoRoot + '/', '');
    if (!cmd.startsWith('bun run automax') && !cmd.startsWith('automax ')) {
      console.log(
        `✖ ${rel}:${b.line} — only "bun run automax ..." / "automax ..." commands may be verified: ${cmd}`,
      );
      failed++;
      continue;
    }
    const args = cmd.replace(/^bun run automax\s*/, '').replace(/^automax\s*/, '');
    const res = spawnSync(
      'node',
      ['--import', 'tsx', 'packages/cli/src/bin.ts', ...splitArgs(args)],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 120_000,
      },
    );
    if (res.status === 0) {
      console.log(`✔ ${rel}:${b.line} — automax ${args}`);
    } else {
      failed++;
      console.log(
        `✖ ${rel}:${b.line} — automax ${args} (exit ${res.status})\n${(res.stderr || res.stdout || '').trim()}`,
      );
    }
  }
}
console.log(`docs:verify — ${blocks.length} block(s), ${failed} failure(s)`);
process.exit(failed ? 1 : 0);

function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}
