import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import { parseDocument, stringify as toYaml } from 'yaml';
import { BrowserSchema, LayerSchema, ProjectConfigSchema, SlugSchema } from '@sdods/contracts';
import { ProjectRegistry, SdodsError, PROJECT_FILE } from '@sdods/core';
import { createContext, type CliContext } from '../context.js';
import { collect, json, ok, out, table } from '../ui.js';
import { projectTemplateFiles } from '../templates/project.js';

export function registerProjectCommands(program: Command) {
  const project = program
    .command('project')
    .description('Create, import, list and delete SDODS projects');

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
    .option('--description <text>', 'one-line description')
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
        throw new SdodsError('CONFIG_INVALID', `Project "${slug}" already exists at ${root}.`, {
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
        ...(opts.description ? { description: opts.description } : {}),
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
        `# SDODS project. Reference: ${'https://docs.sdods.com/docs/reference/project-yaml'}\n${yamlText}`,
      );
      if (ctx.opts.json) return json({ slug, root, files: [PROJECT_FILE, ...Object.keys(files)] });
      ok(`Created project ${slug} at ${root}`);
      for (const f of [PROJECT_FILE, ...Object.keys(files)]) console.log(`  ${f}`);
      console.log(`\nNext: sdods run -p ${slug} -e ${opts.env} -l api`);
    });

  project
    .command('delete <slug>')
    .description('Move a project out of projects/ into .sdods/trash so it can be restored by hand')
    .option('--yes', 'confirm the delete (required: there is no interactive prompt)')
    .option('--purge', 'delete the directory outright instead of trashing it')
    .action((slug: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const entry = requireProject(ctx, slug);
      if (!opts.yes) {
        throw new SdodsError(
          'CONFIG_INVALID',
          `Refusing to ${opts.purge ? 'purge' : 'delete'} "${slug}" without confirmation.`,
          {
            hint: `Re-run with --yes. The project directory is ${entry.root}.`,
            exitCode: 2,
          },
        );
      }
      if (opts.purge) {
        rmSync(entry.root, { recursive: true, force: true });
        if (ctx.opts.json) return json({ slug, from: entry.root, to: null, purged: true });
        ok(`Purged project ${slug} (${entry.root})`);
        return;
      }
      const to = join(trashDir(ctx.rootDir), `${slug}-${timestamp()}`);
      mkdirSync(join(to, '..'), { recursive: true });
      move(entry.root, to);
      if (ctx.opts.json) return json({ slug, from: entry.root, to, purged: false });
      ok(`Deleted project ${slug}`);
      out(`  moved to ${to}`);
      out(`  restore with: mv ${JSON.stringify(to)} ${JSON.stringify(entry.root)}`);
    });

  project
    .command('import <source>')
    .description(
      'Register an existing SDODS project from a directory, a .zip archive or a git repository',
    )
    .option('--slug <slug>', 'import under a different slug (use on a collision)')
    .option('--workspace <slug>', 'workspace to re-home the project into')
    .option('--force', 'overwrite an existing project with the same slug')
    .option('--dry-run', 'validate and report what would be imported, without writing')
    .action(async (source: string, opts, cmd) => {
      const ctx = createContext(cmd);
      const staged = await stageSource(source);
      try {
        const srcDir = findProjectDir(staged.dir, source);
        const config = readProjectConfig(srcDir);
        const slug = opts.slug ? SlugSchema.parse(opts.slug) : config.slug;
        const workspace = opts.workspace
          ? SlugSchema.parse(opts.workspace)
          : ctx.registry.workspaceFile.defaultWorkspace;
        assertWorkspaceDeclared(ctx, workspace);
        const target = join(ctx.registry.projectsDir, slug);
        const collides = existsSync(join(target, PROJECT_FILE));
        if (collides && !opts.force) {
          throw new SdodsError('CONFIG_INVALID', `Project "${slug}" already exists at ${target}.`, {
            hint: 'Pass --slug <other> to import alongside it, or --force to overwrite.',
            exitCode: 2,
          });
        }
        const report = {
          slug,
          name: config.name,
          description: config.description ?? null,
          layers: config.layers,
          browsers: config.browsers,
          envs: config.envs.available,
          workspace,
          organization: ctx.registry.workspaceFile.organization.slug,
          source: staged.kind,
          files: countFiles(srcDir),
          root: target,
          collides,
        };

        if (opts.dryRun) {
          if (ctx.opts.json) return json({ ...report, dryRun: true });
          ok(`Would import ${slug} (${report.files} files) into ${target}`);
          out(`  layers ${report.layers.join(',')} · envs ${report.envs.join(',')}`);
          return;
        }

        // Roll back wholesale on failure: a half-copied project with a bad workspace makes
        // `discover` throw for *every* project, not just this one.
        const backup = collides ? join(trashDir(ctx.rootDir), `${slug}-${timestamp()}`) : null;
        if (backup) {
          mkdirSync(join(backup, '..'), { recursive: true });
          move(target, backup);
        }
        try {
          cpSync(srcDir, target, { recursive: true, filter: importFilter(srcDir) });
          rehome(join(target, PROJECT_FILE), {
            slug,
            workspace,
            organization: ctx.registry.workspaceFile.organization.slug,
          });
          // Prove the whole registry still loads before we claim success.
          ProjectRegistry.discover(ctx.rootDir);
        } catch (e) {
          rmSync(target, { recursive: true, force: true });
          if (backup) move(backup, target);
          throw e;
        }
        if (ctx.opts.json) return json(report);
        ok(`Imported project ${slug} into ${target}`);
        out(`  ${report.files} files · layers ${report.layers.join(',')}`);
        out(`  re-homed to organization ${report.organization} / workspace ${workspace}`);
        if (backup) out(`  the project it replaced was moved to ${backup}`);
        out(`\nNext: sdods lint -p ${slug}`);
      } finally {
        staged.cleanup();
      }
    });
}

/** Keep the generated yaml readable: drop defaults the schema fills in. */
function minimalYaml(config: ReturnType<typeof ProjectConfigSchema.parse>) {
  return {
    slug: config.slug,
    name: config.name,
    ...(config.description ? { description: config.description } : {}),
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

function requireProject(ctx: CliContext, slug: string) {
  if (!ctx.registry.has(slug)) {
    const known = ctx.registry.entriesList().map((e) => e.slug);
    throw new SdodsError(
      'PROJECT_NOT_FOUND',
      `No project "${slug}" under ${ctx.registry.projectsDir}.`,
      {
        hint: known.length
          ? `Known projects: ${known.join(', ')}.`
          : 'This workspace has no projects.',
      },
    );
  }
  return ctx.registry.entry(slug);
}

/**
 * Trash lives outside `projectsDir` on purpose: `ProjectRegistry.discover` walks every directory
 * there looking for a project file, so a trash folder nested inside it would keep resurfacing.
 * `.sdods/` is already gitignored and already holds run artifacts.
 */
function trashDir(rootDir: string): string {
  return join(rootDir, '.sdods', 'trash');
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/** rename, falling back to copy+remove when the two paths live on different filesystems. */
function move(from: string, to: string) {
  try {
    renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

const EXCLUDED = /(^|\/)(\.auth|node_modules|\.features-gen|\.git)(\/|$)/;
/** `.env.example` is the scaffold's own template, not a secret; every generated project has one. */
const SECRET_ENV = /(^|\/)\.env(\.(?!example)[^/]*)?$/;

function importFilter(srcDir: string) {
  return (p: string) => {
    const rel = relative(srcDir, p).replace(/\\/g, '/');
    if (!rel) return true;
    return !EXCLUDED.test(rel) && !SECRET_ENV.test(rel);
  };
}

function countFiles(dir: string): number {
  const keep = importFilter(dir);
  let n = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (!keep(abs)) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else n++;
    }
  };
  walk(dir);
  return n;
}

type SourceKind = 'directory' | 'zip' | 'git';

interface StagedSource {
  kind: SourceKind;
  dir: string;
  cleanup: () => void;
}

function sourceKind(source: string): SourceKind {
  if (/^(https?|git|ssh):\/\//.test(source) || /^git@/.test(source) || source.endsWith('.git'))
    return 'git';
  if (/\.zip$/i.test(source)) return 'zip';
  return 'directory';
}

/** Materialise the source into a directory we can read, cloning or extracting when needed. */
async function stageSource(source: string): Promise<StagedSource> {
  const kind = sourceKind(source);
  if (kind === 'directory') {
    const dir = resolve(source);
    if (!existsSync(dir) || !statSync(dir).isDirectory())
      throw new SdodsError('CONFIG_NOT_FOUND', `No such directory: ${dir}.`, {
        hint: 'Pass a project directory, a .zip archive or a git URL.',
      });
    return { kind, dir, cleanup: () => {} };
  }

  const temp = mkdtempSync(join(tmpdir(), 'sdods-import-'));
  const cleanup = () => rmSync(temp, { recursive: true, force: true });
  try {
    if (kind === 'git') {
      run('git', ['clone', '--depth', '1', source, temp], {
        missing: 'git is not on PATH, so a git URL cannot be cloned.',
        hint: 'Clone it yourself and import the directory instead.',
      });
    } else {
      const zip = resolve(source);
      if (!existsSync(zip))
        throw new SdodsError('CONFIG_NOT_FOUND', `No such archive: ${zip}.`, {});
      extractZip(zip, temp);
    }
    return { kind, dir: temp, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * No zip dependency: bsdtar (macOS, Windows 10+) reads zip archives directly, and `unzip` covers
 * the Linux distros where tar is GNU tar and cannot.
 */
function extractZip(zip: string, into: string) {
  const viaTar = spawnSync('tar', ['-xf', zip, '-C', into], { stdio: 'ignore' });
  if (viaTar.status === 0) return;
  const viaUnzip = spawnSync('unzip', ['-q', zip, '-d', into], { stdio: 'ignore' });
  if (viaUnzip.status === 0) return;
  throw new SdodsError('NOT_SUPPORTED', `Could not extract ${zip}.`, {
    hint: 'Neither `tar -xf` nor `unzip` could read it. Extract it yourself and import the directory.',
  });
}

function run(cmd: string, args: string[], msg: { missing: string; hint?: string }) {
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT')
    throw new SdodsError('NOT_SUPPORTED', msg.missing, { hint: msg.hint });
  if (res.status !== 0)
    throw new SdodsError('CONFIG_INVALID', `${cmd} ${args[0]} failed (exit ${res.status}).`, {
      hint: msg.hint,
    });
}

/**
 * Accept either a project directory or a repository that contains one, so importing a colleague's
 * checkout works without asking them where the yaml is.
 */
function findProjectDir(dir: string, source: string): string {
  if (existsSync(join(dir, PROJECT_FILE))) return dir;
  const nested: string[] = [];
  const scan = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (!statSync(abs).isDirectory() || EXCLUDED.test(name)) continue;
      if (existsSync(join(abs, PROJECT_FILE))) nested.push(abs);
      else if (depth > 0) scan(abs, depth - 1);
    }
  };
  scan(dir, 1);
  if (nested.length === 1) return nested[0]!;
  if (nested.length > 1) {
    throw new SdodsError('CONFIG_INVALID', `${source} contains ${nested.length} projects.`, {
      hint: `Import them one at a time: ${nested.map((d) => relative(dir, d)).join(', ')}.`,
      exitCode: 2,
    });
  }
  throw new SdodsError('CONFIG_NOT_FOUND', `No ${PROJECT_FILE} found in ${source}.`, {
    hint: `Expected it at the root, or one level down (as in projects/<slug>/${PROJECT_FILE}).`,
  });
}

function readProjectConfig(dir: string) {
  const file = join(dir, PROJECT_FILE);
  const doc = parseDocument(readFileSync(file, 'utf8'));
  const parsed = ProjectConfigSchema.safeParse(doc.toJS());
  if (!parsed.success) {
    throw new SdodsError('CONFIG_INVALID', `${file} is not a valid SDODS project.`, {
      hint: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
      exitCode: 2,
    });
  }
  return parsed.data;
}

function assertWorkspaceDeclared(ctx: CliContext, workspace: string) {
  const declared = ctx.registry.workspaceFile.workspaces.map((w) => w.slug);
  if (declared.includes(workspace)) return;
  throw new SdodsError(
    'CONFIG_INVALID',
    `Workspace "${workspace}" is not declared in the workspace file.`,
    {
      hint: `Declared workspaces: ${declared.join(', ')}. Importing into an undeclared workspace would make every project fail to load.`,
      exitCode: 2,
    },
  );
}

/**
 * Re-home the imported yaml, comment-preserving. Without this the project keeps the organization
 * and workspace of wherever it came from, and `discover` then rejects the *whole* registry.
 */
function rehome(file: string, to: { slug: string; workspace: string; organization: string }) {
  const doc = parseDocument(readFileSync(file, 'utf8'));
  doc.set('slug', to.slug);
  doc.set('organization', to.organization);
  doc.set('workspace', to.workspace);
  writeFileSync(file, doc.toString({ lineWidth: 100 }));
}
