import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Agent Skills SDODS ships to users. `packages/cli/skills/` is the one source: `sdods init`
 * copies it into new workspaces, `sdods skills install` copies it into any project or home
 * directory, the npm tarball carries it, and scripts/build-agent-plugin.ts builds the public
 * skills repository and Claude Code plugin from it.
 */
export function bundledSkillsDir(): string {
  // src/skills-catalog.ts and dist/skills-catalog.js both sit one level below packages/cli
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills');
}

export interface BundledSkill {
  name: string;
  description: string;
  dir: string;
}

export function listBundledSkills(dir = bundledSkillsDir()): BundledSkill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map((e) => {
      const fm = frontmatter(readFileSync(join(dir, e.name, 'SKILL.md'), 'utf8'));
      return { name: fm.name ?? e.name, description: fm.description ?? '', dir: join(dir, e.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The `name:` and `description:` lines of a SKILL.md frontmatter block (single-line values). */
export function frontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]!] = kv[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * Where each agent family looks for skills, relative to a project root (or to the home directory
 * with `global`). `.agents/skills` is the shared location read by Codex, Cursor, Gemini CLI,
 * GitHub Copilot, OpenCode, Amp and Goose; Claude Code reads `.claude/skills`.
 */
export const SKILL_TARGETS = {
  claude: '.claude/skills',
  agents: '.agents/skills',
  cursor: '.cursor/skills',
  copilot: '.github/skills',
  gemini: '.gemini/skills',
} as const;

export type SkillTarget = keyof typeof SKILL_TARGETS;
export const DEFAULT_SKILL_TARGETS: SkillTarget[] = ['claude', 'agents'];

/** GitHub Copilot's user-level directory is `~/.copilot/skills`, not `~/.github/skills`. */
const GLOBAL_OVERRIDES: Partial<Record<SkillTarget, string>> = { copilot: '.copilot/skills' };

export interface InstallSkillsOptions {
  rootDir: string;
  targets?: SkillTarget[];
  global?: boolean;
  skills?: string[];
  force?: boolean;
  home?: string;
  source?: string;
}

export interface InstalledSkill {
  skill: string;
  target: SkillTarget;
  path: string;
  status: 'installed' | 'replaced' | 'skipped';
}

export function installSkills(o: InstallSkillsOptions): InstalledSkill[] {
  const available = listBundledSkills(o.source);
  const wanted = o.skills?.length ? o.skills : available.map((s) => s.name);
  const unknown = wanted.filter((w) => !available.some((s) => s.name === w));
  if (unknown.length)
    throw new Error(
      `Unknown skill ${unknown.join(', ')}. Bundled: ${available.map((s) => s.name).join(', ')}`,
    );
  const base = o.global ? (o.home ?? homedir()) : o.rootDir;
  const results: InstalledSkill[] = [];
  for (const target of o.targets?.length ? o.targets : DEFAULT_SKILL_TARGETS) {
    const rel = (o.global && GLOBAL_OVERRIDES[target]) || SKILL_TARGETS[target];
    for (const skill of available.filter((s) => wanted.includes(s.name))) {
      const path = join(base, rel, skill.name);
      const exists = existsSync(join(path, 'SKILL.md'));
      if (exists && !o.force) {
        results.push({ skill: skill.name, target, path, status: 'skipped' });
        continue;
      }
      cpSync(skill.dir, path, { recursive: true, force: true });
      results.push({ skill: skill.name, target, path, status: exists ? 'replaced' : 'installed' });
    }
  }
  return results;
}
