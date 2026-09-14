import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/**
 * Registration lists are where parallel feature branches collide: two PRs each append one line,
 * the conflict is resolved by keeping one side, and nothing fails until a user runs the command.
 * On 2026-09-14 that silently dropped `sdods load`, the email step import, the `load` schema
 * export and two commas in the docs navigation. These checks make such a resolution fail CI.
 */

const repoRoot = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const list = (dir: string) => readdirSync(join(repoRoot, dir));

describe('wiring', () => {
  it('every core step library is imported by steps/index.ts', () => {
    const index = read('packages/core/src/steps/index.ts');
    // hooks.steps.ts registers the HAR hooks for bddgen's glob only; the index imports the
    // screenshot hooks it needs directly, since d1dbcff.
    const loadedByGlobOnly = ['hooks.steps.ts'];
    const libraries = list('packages/core/src/steps').filter(
      (f) => f.endsWith('.steps.ts') && !loadedByGlobOnly.includes(f),
    );
    const missing = libraries.filter(
      (f) => !index.includes(`import './${f.replace(/\.ts$/, '.js')}';`),
    );
    expect(missing, 'step libraries not imported by packages/core/src/steps/index.ts').toEqual([]);
  });

  it('every CLI command module is imported and registered by program.ts', () => {
    const program = read('packages/cli/src/program.ts');
    const commands = list('packages/cli/src/commands').filter(
      (f) =>
        f.endsWith('.ts') &&
        /export function register\b/.test(read(`packages/cli/src/commands/${f}`)),
    );
    const missing = commands.filter((f) => {
      const imported = program.match(
        new RegExp(
          `import \\{ register as (\\w+) \\} from '\\./commands/${basename(f, '.ts')}\\.js';`,
        ),
      );
      return !imported || !program.includes(`${imported[1]}(program);`);
    });
    expect(missing, 'command modules not registered in packages/cli/src/program.ts').toEqual([]);
  });

  it('every contracts schema module is re-exported by schemas/index.ts', () => {
    const index = read('packages/contracts/src/schemas/index.ts');
    const schemas = list('packages/contracts/src/schemas').filter(
      (f) => f.endsWith('.ts') && f !== 'index.ts',
    );
    const missing = schemas.filter(
      (f) => !index.includes(`export * from './${f.replace(/\.ts$/, '.js')}';`),
    );
    expect(
      missing,
      'schema modules not exported by packages/contracts/src/schemas/index.ts',
    ).toEqual([]);
  });

  describe('docs navigation', () => {
    const metas: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === 'meta.json') metas.push(path);
      }
    };
    walk('apps/docs/content/docs');

    it.each(metas)('%s parses and lists exactly the pages in its folder', (meta) => {
      const parsed = JSON.parse(read(meta)) as { pages?: string[] };
      if (!parsed.pages) return;
      const dir = dirname(meta);
      const onDisk = list(dir)
        .filter((f) => f.endsWith('.mdx'))
        .map((f) => basename(f, '.mdx'));
      const listed = parsed.pages.filter((p) => !p.startsWith('---') && !p.startsWith('...'));
      const dangling = listed.filter((p) => !onDisk.includes(p) && !list(dir).includes(p));
      expect(
        dangling,
        `${relative(repoRoot, join(repoRoot, meta))} lists pages that do not exist`,
      ).toEqual([]);
      expect(new Set(listed).size, 'duplicate entries').toBe(listed.length);
      const unlisted = onDisk.filter((p) => p !== 'index' && !listed.includes(p));
      expect(unlisted, `pages missing from ${meta}`).toEqual([]);
    });
  });
});
