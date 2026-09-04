import type { ProjectConfig } from '@sdods/contracts';

export interface TemplateInput {
  config: ProjectConfig;
  envName: string;
  uiUrl: string;
  apiUrl: string;
}

/** Files written by `sdods project create` (relative path → content). */
export function projectTemplateFiles({
  config,
  envName,
  uiUrl,
  apiUrl,
}: TemplateInput): Record<string, string> {
  const slug = config.slug;
  const pascal = slug.replace(/(^|-)(\w)/g, (_m, _p, c: string) => c.toUpperCase());
  return {
    [`envs/${envName}.yaml`]: `name: ${envName}
ui:
  baseUrl: ${uiUrl}
api:
  baseUrl: ${apiUrl}
  headers: { Accept: application/json }
  auth: { type: none }
  # auth: { type: bearer, token: '\${API_TOKEN}' }
users:
  poolSize: 2
vars: {}
`,
    '.env.example': `# Copy to .env.${envName} (gitignored). Values referenced as \${VAR} in yaml.\n# API_TOKEN=\n`,
    'steps/fixtures.ts': `import { test as base, createBdd } from '@sdods/core/fixtures';
import { HomePage } from '../pages/HomePage.js';
import { auth } from './auth.js';

/**
 * Project-level test object: extends the SDODS merged fixtures with this project's
 * auth strategy and page objects. playwright-bdd imports this file (importTestFrom).
 */
export const test = base.extend<{ homePage: HomePage }>({
  auth: [auth, { scope: 'worker', option: true }],
  homePage: async ({ pages }, use) => {
    await use(pages.get(HomePage));
  },
});

export const { Given, When, Then, Step, BeforeScenario, AfterScenario, BeforeStep, AfterStep, BeforeWorker, AfterWorker } =
  createBdd(test);
`,
    'steps/auth.ts': `import { defineAuth } from '@sdods/core/auth';

/** Login strategy used for storageState reuse. Replace with your app's flow. */
export const auth = defineAuth({
  strategy: 'none',
});
`,
    [`steps/${slug}.steps.ts`]: `import { expect } from '@playwright/test';
import { Then } from './fixtures.js';

// Project-specific steps. Generic UI/API/data steps come from @sdods/core/steps.
Then('the ${config.name} title should be visible', async ({ homePage }) => {
  await expect(homePage.title).toBeVisible();
});
`,
    'pages/HomePage.ts': `import { Fixture, Given } from 'playwright-bdd/decorators';
import { BasePage } from '@sdods/core/pages';
import type { test } from '../steps/fixtures.js';

@Fixture<typeof test>('homePage')
export class HomePage extends BasePage {
  readonly title = this.heal.locator(this.page.locator('h1').first(), {
    role: 'heading',
    description: 'page title',
  });

  @Given('I open the home page')
  async open() {
    await this.goto('home');
  }
}
`,
    'features/health.feature': `@api @smoke
Feature: ${config.name} API health
  As an engineer I want the API to answer so that the rest of the suite is meaningful.

  Scenario: The API root responds
    When I send a GET request to "/"
    Then the response status should be 200
`,
    'features/ui/home.feature': `@ui @smoke
Feature: ${config.name} home page
  Scenario: The home page loads
    Given I open the home page
    Then the page URL should contain "/"
`,
    'data/common/users.csv': `id,username,password,role\n1,user1,\${USER1_PASSWORD},standard\n2,user2,\${USER2_PASSWORD},standard\n3,admin1,\${ADMIN1_PASSWORD},admin\n`,
    [`data/${envName}/.gitkeep`]: '',
    'data/factories.ts': `import { defineFactories } from '@sdods/core/data';

export default defineFactories({
  user: (f) => ({
    email: f.internet.email(),
    firstName: f.person.firstName(),
    lastName: f.person.lastName(),
  }),
});
`,
    'recorded/.gitkeep': '',
    'har/.gitkeep': '',
    'README.md': `# ${config.name} (${slug})

SDODS project. Run:

\`\`\`bash
sdods run -p ${slug} -e ${envName} -l api
sdods run -p ${slug} -e ${envName} -l ui -b chromium -t @smoke
sdods lint -p ${slug}
\`\`\`

- \`sdods.project.yaml\` — project settings (layers, browsers, tags, data, auth, screenshots)
- \`envs/\` — one yaml per environment; secrets via \`\${VAR}\` from \`.env.<env>\`
- \`features/\` — Gherkin; \`steps/\` — project steps + fixtures; \`pages/\` — page objects (decorators)
- \`data/\` — CSV/JSON/YAML per environment with \`data/common\` fallback
- \`${pascal}\` page object in \`pages/HomePage.ts\` shows the heal-aware locator style
`,
  };
}
