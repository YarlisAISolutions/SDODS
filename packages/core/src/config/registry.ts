import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { ZodError } from 'zod';
import {
  WorkspaceFileSchema,
  type Organization,
  type ProcessConfig,
  type ProjectConfig,
  type Workspace,
  type WorkspaceFile,
} from '@automax/contracts';
import { AutomaxError } from '../errors.js';
import { DEFAULT_PROJECTS_DIR, PROJECT_FILE, WORKSPACE_FILE } from './defaults.js';
import {
  loadProjectFile,
  readYamlFile,
  resolveConfig,
  zodToConfigError,
  type CliOverrides,
  type ResolvedConfig,
} from './resolve.js';

export interface RegistryOptions {
  projectsDir?: string;
}

export interface ProjectEntry {
  slug: string;
  root: string;
  file: string;
  config: ProjectConfig;
  envsOnDisk: string[];
  /** workspace the project belongs to (its `workspace:` field or the file's defaultWorkspace) */
  workspace: string;
  organization: string;
}

/** Built-in fallback when a repo has no automax.workspace.yaml. */
export const DEFAULT_WORKSPACE_FILE: WorkspaceFile = {
  organization: { slug: 'default', name: 'Default organization' },
  workspaces: [{ slug: 'default', name: 'Default workspace', organization: 'default' }],
  defaultWorkspace: 'default',
  defaults: { processes: [] },
};

export function loadWorkspaceFile(rootDir: string): { file: string | null; config: WorkspaceFile } {
  const file = join(rootDir, WORKSPACE_FILE);
  if (!existsSync(file)) return { file: null, config: DEFAULT_WORKSPACE_FILE };
  const raw = readYamlFile<Record<string, unknown>>(file) ?? {};
  try {
    const config = WorkspaceFileSchema.parse(raw);
    if (!config.workspaces.some((w) => w.slug === config.defaultWorkspace)) {
      throw new AutomaxError(
        'CONFIG_INVALID',
        `defaultWorkspace "${config.defaultWorkspace}" is not declared in workspaces[] of ${file}.`,
        { exitCode: 2 },
      );
    }
    return { file, config };
  } catch (e) {
    if (e instanceof ZodError) throw zodToConfigError(e, file);
    throw e;
  }
}

/** Discovers `projects/<slug>/automax.project.yaml` files and resolves configs (memoised per slug+env+cli). */
export class ProjectRegistry {
  private readonly entries = new Map<string, ProjectEntry>();
  private readonly resolved = new Map<string, ResolvedConfig>();
  readonly rootDir: string;
  readonly projectsDir: string;
  readonly workspaceFile: WorkspaceFile;
  readonly workspaceFilePath: string | null;

  private constructor(
    rootDir: string,
    projectsDir: string,
    ws: { file: string | null; config: WorkspaceFile },
  ) {
    this.rootDir = rootDir;
    this.projectsDir = projectsDir;
    this.workspaceFile = ws.config;
    this.workspaceFilePath = ws.file;
  }

  static discover(rootDir: string, opts: RegistryOptions = {}): ProjectRegistry {
    const root = resolvePath(rootDir);
    const projectsDir = resolvePath(
      root,
      opts.projectsDir ?? process.env.AUTOMAX_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR,
    );
    const reg = new ProjectRegistry(root, projectsDir, loadWorkspaceFile(root));
    if (existsSync(projectsDir)) {
      for (const name of readdirSync(projectsDir).sort()) {
        const dir = join(projectsDir, name);
        if (!statSync(dir).isDirectory()) continue;
        const file = join(dir, PROJECT_FILE);
        if (!existsSync(file)) continue;
        const config = loadProjectFile(dir);
        const envsDir = join(dir, 'envs');
        const envsOnDisk = existsSync(envsDir)
          ? readdirSync(envsDir)
              .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
              .map((f) => f.replace(/\.ya?ml$/, ''))
              .sort()
          : [];
        const ws = reg.workspaceFile;
        const workspace = config.workspace ?? ws.defaultWorkspace;
        if (!ws.workspaces.some((w) => w.slug === workspace)) {
          throw new AutomaxError(
            'CONFIG_INVALID',
            `Project "${config.slug}" references workspace "${workspace}" which is not declared in ${WORKSPACE_FILE}.`,
            {
              hint: `Declared workspaces: ${ws.workspaces.map((w) => w.slug).join(', ')}. Add it to workspaces[] or fix the project's workspace: field.`,
              exitCode: 2,
            },
          );
        }
        const organization = config.organization ?? ws.organization.slug;
        if (organization !== ws.organization.slug) {
          throw new AutomaxError(
            'CONFIG_INVALID',
            `Project "${config.slug}" references organization "${organization}" but this repo belongs to "${ws.organization.slug}".`,
            { exitCode: 2 },
          );
        }
        reg.entries.set(config.slug, {
          slug: config.slug,
          root: dir,
          file,
          config,
          envsOnDisk,
          workspace,
          organization,
        });
      }
    }
    return reg;
  }

  /** Walk up from a directory to find the repo root (package.json with workspaces or projects/ dir). */
  static findRepoRoot(start = process.cwd()): string {
    let dir = resolvePath(start);
    for (let i = 0; i < 12; i++) {
      if (
        existsSync(join(dir, 'automax.config.ts')) ||
        existsSync(join(dir, 'automax.config.json')) ||
        existsSync(join(dir, WORKSPACE_FILE))
      )
        return dir;
      if (existsSync(join(dir, DEFAULT_PROJECTS_DIR)) && existsSync(join(dir, 'package.json')))
        return dir;
      if (existsSync(join(dir, PROJECT_FILE))) return dirname(dirname(dir));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return resolvePath(start);
  }

  list(): ProjectConfig[] {
    return [...this.entries.values()].map((e) => e.config);
  }

  entriesList(): ProjectEntry[] {
    return [...this.entries.values()];
  }

  has(slug: string): boolean {
    return this.entries.has(slug);
  }

  get(slug: string): ProjectConfig {
    return this.entry(slug).config;
  }

  entry(slug: string): ProjectEntry {
    const e = this.entries.get(slug);
    if (!e) {
      const known = [...this.entries.keys()];
      throw new AutomaxError('PROJECT_NOT_FOUND', `Unknown project "${slug}".`, {
        hint: known.length
          ? `Known projects: ${known.join(', ')}.`
          : `No projects found under ${this.projectsDir}. Run \`automax project create <slug>\`.`,
        details: { known, projectsDir: this.projectsDir },
        exitCode: 2,
      });
    }
    return e;
  }

  rootOf(slug: string): string {
    return this.entry(slug).root;
  }

  /** The organization this repo belongs to. */
  organization(): Organization {
    return this.workspaceFile.organization;
  }

  /** All workspaces declared for the organization (one org can hold many). */
  workspaces(): Workspace[] {
    return this.workspaceFile.workspaces;
  }

  workspaceOf(slug: string): Workspace {
    const e = this.entry(slug);
    return this.workspaceFile.workspaces.find((w) => w.slug === e.workspace)!;
  }

  projectsInWorkspace(workspaceSlug: string): ProjectEntry[] {
    return this.entriesList().filter((e) => e.workspace === workspaceSlug);
  }

  /** Hierarchy tree: organization → workspaces → projects → modules. */
  tree(): {
    organization: Organization;
    workspaces: Array<{
      workspace: Workspace;
      projects: Array<{
        slug: string;
        name: string;
        modules: ProjectConfig['modules'];
        processes: string[];
      }>;
    }>;
  } {
    return {
      organization: this.organization(),
      workspaces: this.workspaces().map((workspace) => ({
        workspace,
        projects: this.projectsInWorkspace(workspace.slug).map((e) => ({
          slug: e.slug,
          name: e.config.name,
          modules: e.config.modules,
          processes: this.processesOf(e.slug).map((p) => p.name),
        })),
      })),
    };
  }

  /** Processes visible to a project: workspace defaults overridden by same-named project processes. */
  processesOf(slug: string): ProcessConfig[] {
    const e = this.entry(slug);
    const byName = new Map<string, ProcessConfig>();
    for (const p of this.workspaceFile.defaults.processes) byName.set(p.name, p);
    for (const p of e.config.processes) byName.set(p.name, p);
    return [...byName.values()];
  }

  processOf(slug: string, name: string): ProcessConfig {
    const p = this.processesOf(slug).find((x) => x.name === name);
    if (!p) {
      throw new AutomaxError(
        'CONFIG_NOT_FOUND',
        `Process "${name}" is not defined for project ${slug}.`,
        {
          hint: `Known processes: ${
            this.processesOf(slug)
              .map((x) => x.name)
              .join(', ') || '(none)'
          }. Define it under processes: in ${PROJECT_FILE} or defaults.processes in ${WORKSPACE_FILE}.`,
          exitCode: 2,
        },
      );
    }
    return p;
  }

  /** Module owning a feature file path (relative to the project's features dir), by directory prefix. */
  moduleOfFeature(
    slug: string,
    featureRelPath: string,
  ): ProjectConfig['modules'][number] | undefined {
    const e = this.entry(slug);
    const rel = featureRelPath.replace(/\\/g, '/').replace(/^features\//, '');
    return e.config.modules.find((m) => {
      const dir = (m.path ?? m.name).replace(/^features\//, '').replace(/\/$/, '');
      return rel === dir || rel.startsWith(`${dir}/`);
    });
  }

  envsOf(slug: string): string[] {
    const e = this.entry(slug);
    const declared = e.config.envs.available;
    return declared.filter((name) => e.envsOnDisk.includes(name));
  }

  resolve(
    slug: string,
    env?: string,
    cliOverrides?: CliOverrides,
    processEnv?: NodeJS.ProcessEnv,
  ): ResolvedConfig {
    const e = this.entry(slug);
    const key = `${slug}|${env ?? ''}|${cliOverrides ? JSON.stringify(cliOverrides) : ''}`;
    const cached = this.resolved.get(key);
    if (cached && !processEnv) return cached;
    const cfg = resolveConfig({
      rootDir: this.rootDir,
      projectRoot: e.root,
      env,
      cliOverrides,
      processEnv,
    });
    if (!processEnv) this.resolved.set(key, cfg);
    return cfg;
  }

  /** Resolve the single project selected by slug or, when only one exists, that one. */
  pick(slug?: string): ProjectEntry {
    if (slug) return this.entry(slug);
    const all = this.entriesList();
    if (all.length === 1) return all[0]!;
    throw new AutomaxError(
      'PROJECT_NOT_FOUND',
      all.length ? 'Several projects found; pass --project <slug>.' : 'No projects found.',
      {
        hint: all.length
          ? `Known projects: ${all.map((p) => p.slug).join(', ')}.`
          : 'Run `automax project create <slug>`.',
        exitCode: 2,
      },
    );
  }

  static slugFromDir(dir: string): string {
    return basename(dir);
  }
}
