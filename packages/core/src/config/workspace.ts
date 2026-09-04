import { relative, resolve as resolvePath } from 'node:path';
import type { ModuleConfig, ProjectConfig } from '@automax/contracts';
import { AutomaxError } from '../errors.js';

/** Directory (absolute) of a module's features. */
export function moduleDir(projectRoot: string, mod: ModuleConfig): string {
  return resolvePath(projectRoot, 'features', mod.path ?? mod.name);
}

/** Module owning a feature file, if any (deepest matching directory wins). */
export function moduleForFeature(
  project: ProjectConfig & { root: string },
  featureFile: string,
): ModuleConfig | undefined {
  const abs = resolvePath(project.root, featureFile);
  let best: { mod: ModuleConfig; depth: number } | undefined;
  for (const mod of project.modules) {
    const dir = moduleDir(project.root, mod);
    const rel = relative(dir, abs);
    if (rel === '' || rel.startsWith('..')) continue;
    const depth = dir.split(/[\\/]/).length;
    if (!best || depth > best.depth) best = { mod, depth };
  }
  return best?.mod;
}

export function moduleByName(project: ProjectConfig, name: string): ModuleConfig {
  const mod = project.modules.find((m) => m.name === name);
  if (!mod) {
    throw new AutomaxError(
      'CONFIG_INVALID',
      `Unknown module "${name}" for project ${project.slug}.`,
      {
        hint: `Known modules: ${project.modules.map((m) => m.name).join(', ') || '(none)'}.`,
        exitCode: 2,
      },
    );
  }
  return mod;
}
