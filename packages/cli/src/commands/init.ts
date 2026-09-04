import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { OrganizationSchema, SlugSchema, WorkspaceSchema } from '@automax/contracts';
import { AutomaxError, VERSION, WORKSPACE_FILE } from '@automax/core';
import { globalOptions } from '../context.js';
import { json, ok, out, warn } from '../ui.js';

/** Root of the AutoMax monorepo this CLI runs from (used by --link and to copy the demo). */
export function sourceRepoRoot(): string {
  // packages/cli/src/commands/init.ts → repo root
  return resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
}

export interface InitFlags {
  db: 'sqlite' | 'postgres';
  pm: 'bun' | 'pnpm';
  demo: boolean;
  claude?: boolean;
  from?: string;
  git?: boolean;
  link?: boolean;
  install: boolean;
  browsers: boolean;
  org: string;
  orgName?: string;
  workspace: string;
  workspaceName?: string;
  force?: boolean;
}

export function register(program: Command) {
  program
    .command('init [dir]')
    .description(
      'Scaffold a new AutoMax workspace: workspace yaml, Playwright config, demo project, skills',
    )
    .option('--db <driver>', 'sqlite | postgres (written to .env.example)', 'sqlite')
    .option('--pm <manager>', 'bun | pnpm', 'bun')
    .option('--no-demo', 'skip projects/demo-shop')
    .option(
      '--claude',
      'also write .claude/agents and .mcp.json via `automax agent install-claude`',
    )
    .option('--from <app>', 'analyze an application repo and create a project from it')
    .option('--git', 'git init and make an initial commit')
    .option(
      '--link',
      'depend on the local AutoMax packages (development) instead of the npm registry',
    )
    .option('--no-install', 'skip the package manager install step')
    .option('--no-browsers', 'skip `playwright install chromium`')
    .option('--org <slug>', 'organization slug', 'default')
    .option('--org-name <name>', 'organization display name')
    .option('--workspace <slug>', 'workspace slug', 'default')
    .option('--workspace-name <name>', 'workspace display name')
    .option('--force', 'write into a non-empty directory')
    .action(async (dir: string | undefined, flags: InitFlags, cmd: Command) => {
      const opts = globalOptions(cmd);
      const target = resolvePath(opts.cwd ?? process.cwd(), dir ?? '.');
      const result = await initWorkspace(target, flags);
      if (opts.json) return json(result);
      const run = flags.pm === 'bun' ? 'bun run' : 'pnpm';
      ok(`AutoMax workspace ready at ${target}`);
      for (const f of result.files) out(`  ${f}`);
      out('');
      out(pc.bold('Next steps'));
      if (dir) out(`  cd ${dir}`);
      if (!flags.install)
        out(`  ${flags.pm} install && npx playwright install --with-deps chromium`);
      out(`  ${run} automax doctor`);
      out(`  ${run} automax workspace tree`);
      if (result.demo) out(`  ${run} automax run -p demo-shop -e staging -l api`);
      else
        out(
          `  ${run} automax project create my-app --ui-url http://localhost:3000 --api-url http://localhost:3000/api`,
        );
    });
}

export interface InitResult {
  dir: string;
  files: string[];
  installed: boolean;
  browsers: boolean;
  demo: boolean;
}

export async function initWorkspace(target: string, flags: InitFlags): Promise<InitResult> {
  if (!['sqlite', 'postgres'].includes(flags.db)) {
    throw new AutomaxError(
      'CONFIG_INVALID',
      `--db must be sqlite or postgres, got "${flags.db}".`,
      {
        exitCode: 2,
      },
    );
  }
  if (!['bun', 'pnpm'].includes(flags.pm)) {
    throw new AutomaxError('CONFIG_INVALID', `--pm must be bun or pnpm, got "${flags.pm}".`, {
      exitCode: 2,
    });
  }
  const org = OrganizationSchema.parse({
    slug: SlugSchema.parse(flags.org),
    name: flags.orgName ?? titleCase(flags.org),
  });
  const workspace = WorkspaceSchema.parse({
    slug: SlugSchema.parse(flags.workspace),
    name: flags.workspaceName ?? titleCase(flags.workspace),
    organization: org.slug,
  });

  mkdirSync(target, { recursive: true });
  const existing = readdirSync(target).filter((f) => f !== '.git' && f !== '.DS_Store');
  if (existing.length && !flags.force) {
    throw new AutomaxError('CONFIG_INVALID', `Directory ${target} is not empty.`, {
      hint: 'Pass --force to write into it anyway.',
      exitCode: 2,
    });
  }

  const src = sourceRepoRoot();
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    const file = join(target, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    files.push(rel);
  };

  const name =
    basename(target)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .toLowerCase() || 'automax-tests';
  // --link: bun's `link:` protocol expects a package registered with `bun link` (done below);
  // pnpm accepts a path. Transitive workspace deps resolve from the symlink's real location.
  const dep = (pkg: string) =>
    flags.link
      ? flags.pm === 'bun'
        ? `link:${pkg}`
        : `link:${join(src, 'packages', pkg.replace('@automax/', ''))}`
      : `^${VERSION}`;
  const run = flags.pm === 'bun' ? 'bun run' : 'pnpm';

  write(
    'package.json',
    JSON.stringify(
      {
        name,
        private: true,
        type: 'module',
        version: '0.1.0',
        description: `${name} — AutoMax automation workspace`,
        engines: { node: '>=22' },
        scripts: {
          automax: 'automax',
          test: 'automax run',
          'test:api': 'automax run -l api',
          'test:ui': 'automax run -l ui -b chromium -t @smoke',
          lint: 'automax lint',
          serve: 'automax serve',
          doctor: 'automax doctor',
        },
        dependencies: {
          '@automax/cli': dep('@automax/cli'),
          '@automax/core': dep('@automax/core'),
          '@automax/contracts': dep('@automax/contracts'),
          '@playwright/test':
            flags.link && flags.pm === 'bun' ? 'link:@playwright/test' : '^1.62.1',
          'playwright-bdd': flags.link && flags.pm === 'bun' ? 'link:playwright-bdd' : '^9.2.0',
        },
        devDependencies: {
          '@types/node': '^22.15.0',
          typescript: '~5.9.3',
          tsx: '^4.23.0',
        },
        trustedDependencies: [
          '@playwright/test',
          'playwright',
          'esbuild',
          'better-sqlite3',
          'argon2',
        ],
      },
      null,
      2,
    ) + '\n',
  );

  write(
    WORKSPACE_FILE,
    `# Hierarchy: organization → workspace → project (projects/<slug>) → module (features/<module>).
organization:
  slug: ${org.slug}
  name: ${org.name}
workspaces:
  - slug: ${workspace.slug}
    name: ${workspace.name}
    organization: ${org.slug}
defaultWorkspace: ${workspace.slug}
defaults:
  browsers: [chromium, firefox, webkit]
  suites: [smoke, regression, sanity]
  testIdAttribute: data-testid
  processes:
    - { name: pr-check, title: Pull request check, trigger: pr, tags: '@smoke', browsers: [chromium], harMode: replay, gates: { minPassRate: 100 } }
    - { name: nightly-regression, title: Nightly regression, trigger: nightly, tags: '@regression', browsers: [chromium, firefox, webkit], schedule: '0 2 * * *' }
    - { name: release-gate, title: Release gate, trigger: release, tags: '@smoke or @regression', failOnFlaky: true, gates: { minPassRate: 100, maxFlaky: 0 } }
`,
  );

  write(
    'playwright.config.ts',
    `/**
 * AutoMax Playwright config. Generated from the project registry:
 * one Playwright project per (project × layer × browser), driven by AUTOMAX_* env vars set by \`automax run\`.
 */
import { defineConfig } from '@playwright/test';
import { ProjectRegistry, buildPlaywrightConfig, selectionFromEnv } from '@automax/core/config';

const rootDir = process.env.AUTOMAX_ROOT ?? ProjectRegistry.findRepoRoot(import.meta.dirname);
const registry = ProjectRegistry.discover(rootDir);

export default defineConfig(buildPlaywrightConfig(registry, selectionFromEnv()));
`,
  );

  write(
    'tsconfig.json',
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          noEmit: true,
          types: ['node'],
        },
        include: ['playwright.config.ts', 'projects/**/*.ts'],
        exclude: ['node_modules', '.features-gen', '.automax'],
      },
      null,
      2,
    ) + '\n',
  );

  const envExample = existsSync(join(src, '.env.example'))
    ? readFileSync(join(src, '.env.example'), 'utf8')
    : '';
  write(
    '.env.example',
    (envExample || '# AutoMax platform\nDB_DRIVER=sqlite\nSQLITE_PATH=.automax/automax.db\n')
      .replace(/^DB_DRIVER=.*$/m, `DB_DRIVER=${flags.db}`)
      .replace(
        /^# DATABASE_URL=.*$/m,
        flags.db === 'postgres'
          ? 'DATABASE_URL=postgres://automax:automax@localhost:5432/automax'
          : '# DATABASE_URL=postgres://automax:automax@localhost:5432/automax',
      ),
  );

  write(
    '.gitignore',
    `node_modules/
dist/
.automax/
.features-gen/
test-results/
playwright-report/
blob-report/
*.log
.env
.env.*
!.env.example
projects/*/.auth/
projects/*/.env.*
!projects/*/.env.example
proposals/*/files/
.DS_Store
`,
  );

  const composeSrc = join(src, 'docker-compose.yml');
  write(
    'docker-compose.yml',
    existsSync(composeSrc)
      ? readFileSync(composeSrc, 'utf8')
      : `services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: automax, POSTGRES_PASSWORD: automax, POSTGRES_DB: automax }
    ports: ['5432:5432']
    volumes: [automax-pgdata:/var/lib/postgresql/data]
volumes:
  automax-pgdata:
`,
  );

  const demoSrc = join(src, 'projects', 'demo-shop');
  const withDemo = flags.demo && existsSync(demoSrc);
  write(
    'README.md',
    `# ${name}

AutoMax automation workspace (organization **${org.name}**, workspace **${workspace.name}**).

\`\`\`bash
${flags.pm} install && npx playwright install --with-deps chromium
${run} automax doctor
${run} automax workspace tree
${withDemo ? `${run} automax run -p demo-shop -e staging -l api` : `${run} automax project create my-app --ui-url http://localhost:3000 --api-url http://localhost:3000/api`}
\`\`\`

Docs: https://automax.sdods.com
`,
  );

  if (withDemo) {
    cpSync(demoSrc, join(target, 'projects', 'demo-shop'), {
      recursive: true,
      filter: (p) =>
        !/\/(\.auth|node_modules|\.features-gen)(\/|$)/.test(p) &&
        !/\/\.env\.(?!example)[^/]*$/.test(p),
    });
    // the demo declares the AutoMax org/workspace; re-home it into the new workspace file
    const demoYaml = join(target, 'projects', 'demo-shop', 'automax.project.yaml');
    if (existsSync(demoYaml)) {
      const rehomed = readFileSync(demoYaml, 'utf8')
        .replace(/^organization:.*$/m, `organization: ${org.slug}`)
        .replace(/^workspace:.*$/m, `workspace: ${workspace.slug}`);
      writeFileSync(demoYaml, rehomed);
    }
    files.push('projects/demo-shop/');
  } else {
    write('projects/.gitkeep', '');
  }

  const skillsSrc = join(src, '.claude', 'skills');
  if (existsSync(skillsSrc)) {
    cpSync(skillsSrc, join(target, '.claude', 'skills'), { recursive: true });
    files.push('.claude/skills/');
  }

  if (flags.from) {
    try {
      const analyze = (await import('@automax/core/analyze')) as {
        initFromApp?: (opts: { appPath: string; rootDir: string }) => Promise<{ slug: string }>;
      };
      if (analyze.initFromApp) {
        const created = await analyze.initFromApp({
          appPath: resolvePath(flags.from),
          rootDir: target,
        });
        files.push(`projects/${created.slug}/`);
      } else {
        warn('`automax analyze` is not available in this build; skipping --from.');
      }
    } catch (e) {
      warn(`--from skipped: ${(e as Error).message}`);
    }
  }

  if (flags.git) {
    await execa('git', ['init', '-q'], { cwd: target, reject: false });
  }

  let installed = false;
  if (flags.install && flags.link && flags.pm === 'bun') {
    // Register the local packages so `link:@automax/*` resolves. Playwright and playwright-bdd are
    // linked from the monorepo too: a second @playwright/test copy in the consumer would make
    // Playwright throw "Requiring @playwright/test second time".
    const linkDirs = [
      ...['contracts', 'core', 'cli'].map((pkg) => join(src, 'packages', pkg)),
      ...['@playwright/test', 'playwright-bdd'].map((pkg) => join(src, 'node_modules', pkg)),
    ];
    for (const dir of linkDirs) {
      if (!existsSync(dir)) continue;
      await execa('bun', ['link'], { cwd: dir, reject: false, stdio: 'ignore' });
    }
  }
  if (flags.install) {
    const res = await execa(flags.pm, ['install'], {
      cwd: target,
      stdio: 'inherit',
      reject: false,
    });
    installed = res.exitCode === 0;
    if (!installed) warn(`${flags.pm} install exited with ${res.exitCode}; run it manually.`);
  }
  let browsersInstalled = false;
  if (flags.install && flags.browsers && installed) {
    const res = await execa('npx', ['playwright', 'install', 'chromium'], {
      cwd: target,
      stdio: 'inherit',
      reject: false,
    });
    browsersInstalled = res.exitCode === 0;
  }

  if (flags.claude) {
    const res = await execa('npx', ['automax', 'agent', 'install-claude'], {
      cwd: target,
      reject: false,
      stdio: 'pipe',
    });
    if (res.exitCode === 0) files.push('.claude/agents/', '.mcp.json');
    else warn('`automax agent install-claude` is not available yet; run it later.');
  }

  if (flags.git) {
    await execa('git', ['add', '-A'], { cwd: target, reject: false });
    await execa(
      'git',
      ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Initialize AutoMax workspace'],
      { cwd: target, reject: false },
    );
  }

  return { dir: target, files, installed, browsers: browsersInstalled, demo: withDemo };
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isDir(p: string): boolean {
  return existsSync(p) && statSync(p).isDirectory();
}
