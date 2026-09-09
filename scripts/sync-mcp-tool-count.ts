/**
 * One source of truth for "how many tools does the MCP server expose": the registry itself.
 *
 * The number was hand-maintained in four files with nothing checking it — the marketing site, the
 * MCP tools reference, the `mcp serve` page and a mermaid diagram. All four happened to be right,
 * which is the dangerous state: the next PR that adds a tool makes four claims false at once, in
 * two places that are published to sdods.com and docs.sdods.com, and nothing fails.
 *
 * Run as `bun run mcp:count-sync`; `--check` exits 2 on drift, the way `sync-brand.ts` does.
 * `tests/mcp-tool-count.test.ts` runs the same comparison in `lint-typecheck-unit`, which has no
 * path filter — so a tool-adding PR fails until the four files are re-synced, and re-syncing
 * touches apps/www and apps/docs, which is what triggers the two site deploys.
 *
 * The count is the DEFAULT capability set, not `--caps all`: that is what every one of the four
 * sentences means by "tools", and it is what a client sees unless it opts in.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOLS, DEFAULT_CAPABILITIES } from '@sdods/mcp';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Files carrying the count, one occurrence each, matched as "<n> tools". */
export const COUNTED_FILES = [
  'apps/www/app/page.tsx',
  'apps/docs/content/docs/reference/mcp-tools.mdx',
  'apps/docs/content/docs/reference/cli-commands/mcp-serve.mdx',
  'apps/docs/content/docs/guides/claude-code-and-codex.mdx',
] as const;

const COUNT_RE = /\b\d+ tools\b/g;

/** Tools a client sees with the default capabilities — what the four sentences all mean. */
export function toolCount(): number {
  const defaults = new Set<string>(DEFAULT_CAPABILITIES);
  return ALL_TOOLS.filter((t) => defaults.has(t.capability)).length;
}

export function outputs(): Array<{ path: string; content: string }> {
  const n = toolCount();
  return COUNTED_FILES.map((path) => {
    const full = join(repoRoot, path);
    const current = existsSync(full) ? readFileSync(full, 'utf8') : '';
    const matches = current.match(COUNT_RE) ?? [];
    if (matches.length !== 1) {
      // Being loud beats silently rewriting the wrong number, or none.
      throw new Error(
        `sync-mcp-tool-count — expected exactly one "<n> tools" in ${path}, found ${matches.length}`,
      );
    }
    return { path, content: current.replace(COUNT_RE, `${n} tools`) };
  });
}

function main() {
  const check = process.argv.includes('--check');
  const drift: string[] = [];
  let written = 0;

  for (const { path, content } of outputs()) {
    const full = join(repoRoot, path);
    if (readFileSync(full, 'utf8') === content) continue;
    if (check) {
      drift.push(path);
      continue;
    }
    writeFileSync(full, content);
    written += 1;
  }

  if (check) {
    if (!drift.length) {
      console.log(`sync-mcp-tool-count — all four files say ${toolCount()} tools`);
      return;
    }
    console.error(`sync-mcp-tool-count — ${drift.length} file(s) disagree with the registry`);
    for (const p of drift) console.error(`  ${p}`);
    console.error('\nrun: bun run mcp:count-sync');
    process.exit(2);
  }

  console.log(`sync-mcp-tool-count — ${written} file(s) set to ${toolCount()} tools`);
}

// Guarded so the drift test can import `outputs()` without running the sync.
if (import.meta.url === `file://${process.argv[1]}`) main();
