import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema } from '@sdods/contracts';
import { BROWSERS_FOR_SKIP } from '../src/config/tags.js';
import { lintProject } from '../src/lint/index.js';

/**
 * `BROWSERS_FOR_SKIP` used to be a hand-copied array, so a browser could be added to the schema and
 * `@skip:<it>` would still be rejected by lint — with an error message that listed the old set.
 * It is derived now; these assert the derivation both ways round.
 */
function project(root: string, feature: string) {
  const proj = join(root, 'projects', 'shop');
  mkdirSync(join(proj, 'features'), { recursive: true });
  writeFileSync(join(proj, 'features', 'a.feature'), feature);
  return {
    ...ProjectConfigSchema.parse({
      slug: 'shop',
      name: 'Shop',
      layers: ['ui'],
      browsers: ['chromium'],
      envs: { default: 'staging', available: ['staging'] },
    }),
    root: proj,
  };
}

const feature = (tag: string) =>
  `@ui @smoke\nFeature: F\n\n  ${tag}\n  Scenario: S\n    Given I open the home page\n`;

describe('@skip:<browser> lint', () => {
  it('accepts every browser the schema knows, edge included', async () => {
    expect(BROWSERS_FOR_SKIP).toContain('edge');
    for (const browser of BROWSERS_FOR_SKIP) {
      const root = mkdtempSync(join(tmpdir(), 'sdods-lint-'));
      const res = await lintProject({ project: project(root, feature(`@skip:${browser}`)) });
      expect(res.errors.filter((e) => e.rule === 'tags/skip')).toEqual([]);
    }
  });

  it('still rejects a name that is not a browser, and lists the current set', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sdods-lint-'));
    const res = await lintProject({ project: project(root, feature('@skip:safari')) });
    const skip = res.errors.find((e) => e.rule === 'tags/skip');
    expect(skip?.message).toMatch(/@skip:safari must name a browser/);
    // The message is built from the same list, so it cannot go stale.
    expect(skip?.message).toContain('edge');
  });
});
