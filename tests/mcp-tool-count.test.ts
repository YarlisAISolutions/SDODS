import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_TOOLS, DEFAULT_CAPABILITIES } from '@sdods/mcp';
import { COUNTED_FILES, outputs, toolCount } from '../scripts/sync-mcp-tool-count.js';

const repoRoot = join(import.meta.dirname, '..');

describe('mcp tool count', () => {
  it('every published claim matches the registry', () => {
    // These four sentences are shipped to sdods.com and docs.sdods.com. Nothing used to check
    // them, so a PR that added a tool made all four false at once and CI stayed green.
    const drift = outputs()
      .filter(({ path, content }) => readFileSync(join(repoRoot, path), 'utf8') !== content)
      .map((o) => o.path);
    expect(drift, 'run: bun run mcp:count-sync').toEqual([]);
  });

  it('counts the default capabilities, which is what the sentences mean', () => {
    // `--caps all` is a larger number (agents and issues are opt-in). A client that passes no
    // --caps sees this one, so this is the count the docs should quote.
    const defaults = new Set<string>(DEFAULT_CAPABILITIES);
    const optIn = ALL_TOOLS.filter((t) => !defaults.has(t.capability));
    expect(toolCount()).toBe(ALL_TOOLS.length - optIn.length);
    expect(optIn.length).toBeGreaterThan(0);
  });

  it('still finds exactly one count in each file', () => {
    // outputs() throws if a file gains or loses its "<n> tools" phrase, so a reworded sentence
    // fails here rather than silently dropping out of the sync.
    for (const path of COUNTED_FILES) {
      const matches = readFileSync(join(repoRoot, path), 'utf8').match(/\b\d+ tools\b/g) ?? [];
      expect(matches, `${path} must carry exactly one "<n> tools"`).toHaveLength(1);
    }
  });
});
