import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { stringify as toYaml } from 'yaml';
import { BrowserSchema, LayerSchema, ProjectConfigSchema, SlugSchema } from '@automax/contracts';
import { AutomaxError, PROJECT_FILE } from '@automax/core';
import { createContext } from '../context.js';
import { collect, json, ok, table } from '../ui.js';
import { projectTemplateFiles } from '../templates/project.js';

export function registerProjectCommands(program: Command) {
  const project = program.command('project').description('Create and list AutoMax projects');

  project
    .command('list')
    .description('List projects discovered under projects/')
    .option('--matrix', 'emit a CI matrix (project × browser × shard)')
    .option('--shards <n>', 'shards per browser for --matrix', '1')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const entries = ctx.registry.entriesList();
      if (opts.matrix) {
        const shards = Math.max(1, Number(opts.shards));
        // Projects with `ci.enabled: false` (e.g. ones that need their own server, like the
        // dogfooding project) are left to dedicated jobs.
        const matrix = entries
          .filter((e) => e.config.ci.enabled)
          .flatMap((e) =>
            (e.config.ci.browsers ?? e.config.browsers).flatMap((browser) =>
              Array.from({ length: shards }, (_, i) => ({
                project: e.slug,
                env: e.config.ci.env ?? e.config.envs.default,
                tags: e.config.ci.tags ?? '',
                browser,
                shard: i + 1,
                total: shards,
              })),
            ),
          );
        return json(matrix);
      }
      const rows = entries.map((e) => ({
        slug: e.slug,
        name: e.config.name,
        layers: e.config.layers.join(','),
        browsers: e.config.browsers.join(','),
        envs: e.config.envs.available
          .map((n) => (e.envsOnDisk.includes(n) ? n : `${n}(missing)`))
          .join(','),
        default: e.config.envs.default,
        root: e.root,
      }));
      if (ctx.opts.json) return json(rows);
      table(rows, ['slug', 'name', 'layers', 'browsers', 'envs', 'default']);
    });

  project
    .command('create <slug>')
    .description(
      'Scaffold a project: yaml, envs, fixtures, an auth stub, a page object, health features and data',
    )
    .option('--name <name>', 'display name')
    .option('--layers <list>', 'comma list of ui,api,hybrid,recorded', collect, [])
    .option('--browsers <list>', 'comma list of browsers', collect, [])
    .option('--ui-url <url>', 'UI base URL for the first environment', 'http://localhost:3000')
    .option(
      '--api-url <url>',
      'API base URL for the first environment',
      'http://localhost:3000/api',
    )
    .option('--env <name>', 'first environment name', 'local')
    .option('--test-id <attr>', 'test id attribute', 'data-testid')
    .option('--force', 'overwrite an existing directory')
    .action((slug: string, opts, cmd) => {
      const ctx = createContext(cmd);
      SlugSchema.parse(slug);
      const root = join(ctx.registry.projectsDir, slug);
      if (existsSync(join(root, PROJECT_FILE)) && !opts.force) {
        throw new AutomaxError('CONFIG_INVALID', `Project "${slug}" already exists at ${root}.`, {
          hint: 'Pass --force to overwrite.',
          exitCode: 2,
        });
      }
      const layers = (opts.layers.length ? opts.layers : ['ui', 'api', 'hybrid']).map((l: string) =>
        LayerSchema.parse(l),
      );
      const browsers = (opts.browsers.length ? opts.browsers : ['chromium']).map((b: string) =>
        BrowserSchema.parse(b),
      );
      const config = ProjectConfigSchema.parse({
        slug,
        name: opts.name ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        layers,
        browsers,
        testIdAttribute: opts.testId,
        routes: { home: '/' },
        envs: { default: opts.env, available: [opts.env] },
        data: {
          sources: {
            users: { type: 'csv', path: 'data/{env}/users.csv', fallback: 'data/common/users.csv' },
          },
        },
      });
      const files = projectTemplateFiles({
        config,
        envName: opts.env,
        uiUrl: opts.uiUrl,
        apiUrl: opts.apiUrl,
      });
      for (const [rel, content] of Object.entries(files)) {
        const file = join(root, rel);
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, content);
      }
      const yamlText = toYaml(minimalYaml(config), { lineWidth: 100 });
      writeFileSync(
        join(root, PROJECT_FILE),
        `# AutoMax project. Reference: ${'https://automax.sdods.com/docs/reference/project-yaml'}\n${yamlText}`,
      );
      if (ctx.opts.json) return json({ slug, root, files: [PROJECT_FILE, ...Object.keys(files)] });
      ok(`Created project ${slug} at ${root}`);
      for (const f of [PROJECT_FILE, ...Object.keys(files)]) console.log(`  ${f}`);
      console.log(`\nNext: automax run -p ${slug} -e ${opts.env} -l api`);
    });
}

/** Keep the generated yaml readable: drop defaults the schema fills in. */
function minimalYaml(config: ReturnType<typeof ProjectConfigSchema.parse>) {
  return {
    slug: config.slug,
    name: config.name,
    layers: config.layers,
    browsers: config.browsers,
    testIdAttribute: config.testIdAttribute,
    routes: config.routes,
    tags: { suites: config.tags.suites, extra: config.tags.extra, roles: config.tags.roles },
    envs: config.envs,
    data: {
      sources: config.data.sources,
      userPool: { dataset: 'users', roleColumn: 'role', leaseStore: 'file' },
    },
    auth: { strategy: 'none', storageState: true },
    screenshots: {
      policy: config.screenshots.policy,
      mask: [],
      viewport: config.screenshots.viewport,
    },
    heal: { enabled: true },
    retries: { ci: 2, local: 0 },
  };
}
