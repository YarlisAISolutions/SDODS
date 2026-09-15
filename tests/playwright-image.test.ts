import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Linux visual baselines are rendered in the Playwright container (visual-baselines.yml) and
 * compared in the same container (the nightly @regression job in ci.yml). A container whose
 * Playwright differs from the installed client renders with other browser builds, and every
 * baseline drifts without any code change -- so the image tag must follow the lockfile.
 */
const repoRoot = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const client = (
  JSON.parse(read('node_modules/@playwright/test/package.json')) as { version: string }
).version;

describe('Playwright container image', () => {
  it.each(['.github/workflows/ci.yml', '.github/workflows/visual-baselines.yml'])(
    '%s pins the image to the installed @playwright/test',
    (workflow) => {
      const tags = [
        ...read(workflow).matchAll(/mcr\.microsoft\.com\/playwright:v([\w.-]+?)-noble/g),
      ].map((m) => m[1]);
      expect(tags.length, `${workflow} names no Playwright image`).toBeGreaterThan(0);
      expect(new Set(tags)).toEqual(new Set([client]));
    },
  );

  it('the monthly upgrade moves the image with the client', () => {
    expect(read('.github/workflows/dependencies.yml')).toMatch(
      /Move the Playwright container image with the client/,
    );
  });
});
