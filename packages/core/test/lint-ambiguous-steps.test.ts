import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectConfigSchema } from '@sdods/contracts';
import { lintProject } from '../src/lint/index.js';

/**
 * Issue #60: `sdods lint` reported "no findings" on a suite where bddgen then refused to generate
 * a single spec — "Multiple definitions matched scenario step" — because a project step used the
 * same phrasing as a core step library. Lint has to see the collision the runner will hit.
 */

function project(files: Record<string, string>, exclude?: string[]) {
  const root = join(mkdtempSync(join(tmpdir(), 'sdods-ambig-')), 'projects', 'shop');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return {
    ...ProjectConfigSchema.parse({
      slug: 'shop',
      name: 'Shop',
      layers: ['ui'],
      browsers: ['chromium'],
      envs: { default: 'staging', available: ['staging'] },
      ...(exclude ? { steps: { core: { exclude } } } : {}),
    }),
    root,
  };
}

const A11Y_FEATURE = `Feature: Accessibility

  @ui @smoke
  Scenario: Home is accessible
    Given I navigate to the "home" page
    Then the page should have no accessibility violations of impact "serious" or worse
    And the page should have no accessibility violations of impact "critical" or worse
`;

// The project wrote this phrasing before 0.3.0 shipped the a11y library with the same text.
const PROJECT_A11Y_STEPS = `import { createBdd } from 'playwright-bdd';
const { Then } = createBdd();

Then(
  'the page should have no accessibility violations of impact {string} or worse',
  async ({ page }, level: string) => {},
);
`;

describe('lint: ambiguous step definitions (#60)', () => {
  it('reports a feature step matched by a core library AND a project step, naming both files', async () => {
    const res = await lintProject({
      project: project({
        'features/a11y.feature': A11Y_FEATURE,
        'steps/a11y.steps.ts': PROJECT_A11Y_STEPS,
      }),
    });
    const found = res.errors.filter((e) => e.rule === 'steps/ambiguous');
    // Grouped by library: two step lines collide with the same two definitions → one finding.
    expect(found).toHaveLength(1);
    const [f] = found;
    expect(f!.file).toBe('features/a11y.feature');
    expect(f!.line).toBe(6);
    expect(f!.message).toContain('core library "a11y"');
    expect(f!.message).toMatch(/a11y\.steps\.(ts|js):\d+/);
    expect(f!.message).toContain('steps/a11y.steps.ts:4');
    expect(f!.message).toContain('2 step(s)');
    expect(f!.message).toContain('steps.core.exclude: [a11y]');
  });

  it('is clean once the library is excluded with steps.core.exclude', async () => {
    const res = await lintProject({
      project: project(
        { 'features/a11y.feature': A11Y_FEATURE, 'steps/a11y.steps.ts': PROJECT_A11Y_STEPS },
        ['a11y'],
      ),
    });
    expect([...res.errors, ...res.warnings].filter((e) => e.rule.startsWith('steps/'))).toEqual([]);
  });

  it('sees decorator steps in page objects, regex patterns and outline rows', async () => {
    const res = await lintProject({
      project: project({
        'features/login.feature': `Feature: Login

  @ui @smoke
  Scenario Outline: Login as <user>
    When I log in as "<user>"

    Examples:
      | user  |
      | alice |
`,
        'pages/LoginPage.ts': `import { Fixture, When } from 'playwright-bdd/decorators';
@Fixture('loginPage')
export class LoginPage {
  @When('I log in as {string}')
  async login(user: string) {}
}
`,
        'steps/login.steps.ts': `import { When } from './fixtures.js';
When(/^I log in as "(alice|bob)"$/, async ({}, user: string) => {});
`,
      }),
    });
    const found = res.errors.filter((e) => e.rule === 'steps/ambiguous');
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('pages/LoginPage.ts:4');
    expect(found[0]!.message).toContain('steps/login.steps.ts:2');
    expect(found[0]!.message).toContain('I log in as "alice"');
    // Two project files, no core library involved: excluding a library would not help.
    expect(found[0]!.message).not.toContain('steps.core.exclude');
  });

  it('does not flag a step that exactly one definition matches, or a step tag-scoped apart', async () => {
    const res = await lintProject({
      project: project({
        'features/a.feature': `Feature: A

  @ui @smoke @admin
  Scenario: Admin
    Then the dashboard shows "x"

  @ui @smoke
  Scenario: Other
    Then the dashboard shows "y"
`,
        'steps/a.steps.ts': `import { Then } from './fixtures.js';
Then('the dashboard shows {string}', { tags: '@admin' }, async () => {});
Then('the dashboard shows {string}', { tags: 'not @admin' }, async () => {});
`,
      }),
    });
    expect(res.errors.filter((e) => e.rule === 'steps/ambiguous')).toEqual([]);
  });

  it('warns about a phrasing defined twice even when no feature uses it yet', async () => {
    const res = await lintProject({
      project: project({
        'features/a.feature': `Feature: A\n\n  @ui @smoke\n  Scenario: S\n    Given I navigate to the "home" page\n`,
        'steps/one.steps.ts': `import { Given } from './fixtures.js';\nGiven('the cart is empty', async () => {});\n`,
        'steps/two.steps.ts': `import { Given } from './fixtures.js';\nGiven('the cart is empty', async () => {});\n`,
      }),
    });
    const dup = res.warnings.filter((w) => w.rule === 'steps/duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toContain('steps/one.steps.ts:2');
    expect(dup[0]!.message).toContain('steps/two.steps.ts:2');
  });
});
