import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import type { ProjectProposal } from '@automax/contracts';
import { AutomaxError } from '../errors.js';
import { PROJECT_FILE } from '../config/defaults.js';

export interface ApplyOptions {
  /** repo root that holds projects/ */
  rootDir: string;
  projectsDir?: string;
  /** scaffold files from the CLI project template (steps/fixtures.ts, pages/HomePage.ts, data/…) */
  scaffold?: Record<string, string>;
  force?: boolean;
  /** application repo, used to import Playwright specs into recorded/ */
  appPath?: string;
  importSpecs?: boolean;
}

export interface ApplyResult {
  root: string;
  written: string[];
  skipped: string[];
  importedSpecs: string[];
}

/** Materialise a proposal under projects/<slug>. Refuses to overwrite an existing project unless force. */
export function applyProposal(proposal: ProjectProposal, opts: ApplyOptions): ApplyResult {
  const projectsDir = resolvePath(
    opts.rootDir,
    opts.projectsDir ?? process.env.AUTOMAX_PROJECTS_DIR ?? 'projects',
  );
  const root = join(projectsDir, proposal.slug);
  if (existsSync(join(root, PROJECT_FILE)) && !opts.force) {
    throw new AutomaxError(
      'CONFIG_INVALID',
      `Project "${proposal.slug}" already exists at ${root}.`,
      {
        hint: 'Pass --force to overwrite the generated files, or --slug <other>.',
        exitCode: 2,
      },
    );
  }
  const written: string[] = [];
  const skipped: string[] = [];
  const files: Record<string, string> = {
    ...(opts.scaffold ?? {}),
    ...proposal.files,
    ...proposal.starterFeatures,
    [PROJECT_FILE]: proposal.projectYaml,
  };
  for (const [envName, yaml] of Object.entries(proposal.envYamls))
    files[`envs/${envName}.yaml`] = yaml;
  // scaffold may carry its own health/home features; proposal features win, drop scaffold features that duplicate modules
  for (const rel of Object.keys(files)) {
    if (
      rel.startsWith('features/') &&
      !(rel in proposal.starterFeatures) &&
      Object.keys(proposal.starterFeatures).length
    )
      delete files[rel];
  }
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel);
    if (existsSync(file) && !opts.force && rel !== PROJECT_FILE) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    written.push(rel);
  }
  for (const dir of [
    'recorded',
    'har',
    'data/common',
    `data/${Object.keys(proposal.envYamls)[0] ?? 'local'}`,
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  const importedSpecs =
    opts.importSpecs && opts.appPath ? importPlaywrightSpecs(opts.appPath, root) : [];
  return { root, written: written.sort(), skipped, importedSpecs };
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  'playwright-report',
  'test-results',
]);

/**
 * Copy existing Playwright specs into `recorded/imported/…` so they run as a normal (non-BDD)
 * layer immediately. Imports are left untouched; a header records the origin.
 */
export function importPlaywrightSpecs(appPath: string, projectRoot: string): string[] {
  const app = resolvePath(appPath);
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(abs, depth + 1);
        continue;
      }
      if (!/\.spec\.(ts|js|mjs)$/.test(name) || st.size > 512 * 1024) continue;
      const text = readFileSync(abs, 'utf8');
      if (!/@playwright\/test/.test(text)) continue;
      const rel = relative(app, abs).split(sep).join('/');
      const target = join(projectRoot, 'recorded', 'imported', rel);
      mkdirSync(dirname(target), { recursive: true });
      const header = `// @automax-imported ${JSON.stringify({ from: rel, app: basename(app), importedAt: new Date().toISOString() })}\n`;
      writeFileSync(target, header + text);
      out.push(`recorded/imported/${rel}`);
    }
  };
  walk(app, 0);
  return out.sort();
}
