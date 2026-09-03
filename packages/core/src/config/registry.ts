import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import type { ProjectConfig } from '@automax/contracts';
import { AutomaxError } from '../errors.js';
import { DEFAULT_PROJECTS_DIR, PROJECT_FILE } from './defaults.js';
import {
  loadProjectFile,
  resolveConfig,
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
}

/** Discovers `projects/<slug>/automax.project.yaml` files and resolves configs (memoised per slug+env+cli). */
export class ProjectRegistry {
  private readonly entries = new Map<string, ProjectEntry>();
  private readonly resolved = new Map<string, ResolvedConfig>();
  readonly rootDir: string;
  readonly projectsDir: string;

  private constructor(rootDir: string, projectsDir: string) {
    this.rootDir = rootDir;
    this.projectsDir = projectsDir;
  }

  static discover(rootDir: string, opts: RegistryOptions = {}): ProjectRegistry {
    const root = resolvePath(rootDir);
    const projectsDir = resolvePath(
      root,
      opts.projectsDir ?? process.env.AUTOMAX_PROJECTS_DIR ?? DEFAULT_PROJECTS_DIR,
    );
    const reg = new ProjectRegistry(root, projectsDir);
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
        reg.entries.set(config.slug, { slug: config.slug, root: dir, file, config, envsOnDisk });
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
        existsSync(join(dir, 'automax.config.json'))
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
