import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Commander invokes an action as (...positionalArgs, options, command). A callback that omits the
 * options parameter receives the options object where it expects the Command, so `createContext`
 * fails with "root.opts is not a function" — at runtime, and only for that one subcommand.
 * `users deactivate`, `users set-role` and `tokens revoke` all shipped broken this way.
 *
 * This is a source check on purpose: Commander wraps each callback, so the registered handler's
 * `.length` describes the wrapper rather than the function we care about.
 */
const COMMANDS_DIR = new URL('../src/commands', import.meta.url).pathname;

function mismatches(source: string): string[] {
  const out: string[] = [];
  const re = /\.command\(\s*'([^']+)'[\s\S]{0,1200}?\.action\(\s*async\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const positionals = (m[1]!.match(/[<[][^>\]]+[>\]]/g) ?? []).length;
    const params = m[2]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = params[params.length - 1] ?? '';
    // Only meaningful when the callback actually takes the Command as its final parameter.
    if (!/cmd|command/i.test(last)) continue;
    if (params.length < positionals + 2) {
      out.push(`${m[1]!.split(' ')[0]}: takes ${params.length}, needs ${positionals + 2}`);
    }
  }
  return out;
}

describe('command action signatures', () => {
  const files = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.ts'));

  it('scans the whole command surface', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no action mistakes the options object for the Command', () => {
    const found: string[] = [];
    for (const f of files) {
      for (const bad of mismatches(readFileSync(join(COMMANDS_DIR, f), 'utf8'))) {
        found.push(`${f} → ${bad}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('detects the shape that was broken', () => {
    // deactivate <username> with (username, cmd) is one parameter short.
    expect(
      mismatches(`.command('deactivate <username>').action(async (username: string, cmd) => {`),
    ).toHaveLength(1);
    expect(
      mismatches(
        `.command('deactivate <username>').action(async (username: string, _opts, cmd) => {`,
      ),
    ).toHaveLength(0);
  });
});
