import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  agentMdContent,
  agentsMdContent,
  claudeMdContent,
  skillMdContent,
} from '../src/claude-code/install.js';

const run = promisify(execFile);
const repoRoot = join(import.meta.dirname, '..', '..', '..');

/**
 * The generated agent files tell an agent what to run. They said
 * `sdods lint -p <slug> -e <env>`, and `lint` has no `-e` — so the very first command a new
 * CLAUDE.md offered exited with "unknown option '-e'". One shared flag helper had been applied to
 * every command regardless of what that command accepts, and a test asserted the broken string.
 *
 * This checks the generated text against the CLI itself rather than against another copy of the
 * same assumption.
 */

/** `sdods <command> <flags…>` occurrences inside backticks in the generated markdown. */
function commandsIn(markdown: string): string[] {
  return [...markdown.matchAll(/`(?:bun run )?sdods ([^`]+)`/g)]
    .map((m) => m[1]!.trim())
    .filter((c) => !c.includes('|')); // `proposals list|show|accept` is prose, not a command line
}

/** Splits into the subcommand path (leading non-flag words) and the short/long flags used. */
function parse(command: string): { path: string[]; flags: string[] } {
  const parts = command.split(/\s+/);
  const path: string[] = [];
  for (const p of parts) {
    if (p.startsWith('-')) break;
    path.push(p);
  }
  return { path, flags: parts.filter((p) => /^-{1,2}[a-zA-Z]/.test(p)) };
}

const helpCache = new Map<string, string>();
async function helpFor(path: string[]): Promise<string> {
  const key = path.join(' ');
  const cached = helpCache.get(key);
  if (cached !== undefined) return cached;
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', 'packages/cli/src/bin.ts', ...path, '--help'],
    { cwd: repoRoot, env: { ...process.env, FORCE_COLOR: '0' } },
  );
  helpCache.set(key, stdout);
  return stdout;
}

const generated: Array<[string, string]> = [
  ['CLAUDE.md', claudeMdContent({ project: 'shop', env: 'staging' })],
  ['AGENTS.md', agentsMdContent({ project: 'shop', env: 'staging' })],
  ['AGENT.md', agentMdContent()],
  ['SKILL.md', skillMdContent()],
];

describe('commands in the generated agent files', () => {
  it.each(generated)(
    '%s only uses flags the CLI actually has',
    async (_name, content) => {
      const failures: string[] = [];
      for (const command of commandsIn(content)) {
        const { path, flags } = parse(command);
        if (!path.length) continue;
        let help: string;
        try {
          help = await helpFor(path);
        } catch {
          failures.push(`sdods ${command} — no such command: \`sdods ${path.join(' ')}\``);
          continue;
        }
        for (const flag of flags) {
          // Placeholders like `-b <browser>` still name a real flag; only the flag is checked.
          if (!help.includes(flag)) failures.push(`sdods ${command} — unknown flag ${flag}`);
        }
      }
      expect(failures).toEqual([]);
    },
    180_000,
  );

  it('gives lint a project but never an environment', () => {
    // The specific regression: only `run` takes -e.
    const claude = claudeMdContent({ project: 'shop', env: 'staging' });
    expect(claude).toContain('sdods lint -p shop');
    expect(claude).not.toMatch(/sdods lint[^`]*-e /);
    expect(claude).toContain('sdods run -p shop -e staging');
  });
});
