import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');
const init = readFileSync(join(root, 'packages', 'cli', 'src', 'commands', 'init.ts'), 'utf8');

describe('sdods init manifest', () => {
  // The scaffolded demo project has an @a11y scenario; without axe it fails on a fresh workspace.
  it('installs @axe-core/playwright at the version @sdods/core is tested against', () => {
    const core = JSON.parse(readFileSync(join(root, 'packages', 'core', 'package.json'), 'utf8'));
    const tested = core.devDependencies['@axe-core/playwright'];
    const pin = init.match(/'@axe-core\/playwright': '([^']+)'/)?.[1];
    expect(tested).toBeDefined();
    expect(pin).toBe(tested);
  });
});
