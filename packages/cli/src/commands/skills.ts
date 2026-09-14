import { relative } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { SdodsError } from '@sdods/core';
import { createContext } from '../context.js';
import {
  DEFAULT_SKILL_TARGETS,
  SKILL_TARGETS,
  installSkills,
  listBundledSkills,
  type SkillTarget,
} from '../skills-catalog.js';
import { info, json, ok, out, table } from '../ui.js';

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function register(program: Command) {
  const skills = program
    .command('skills')
    .description('Agent Skills for Claude Code, Codex, Cursor, Copilot, Gemini CLI and others');

  skills
    .command('list')
    .description('List the skills bundled with SDODS')
    .action((_opts, cmd) => {
      const ctx = createContext(cmd);
      const rows = listBundledSkills().map(({ name, description }) => ({ name, description }));
      if (ctx.opts.json) return json(rows);
      table(rows);
    });

  skills
    .command('install')
    .description(
      'Copy the bundled skills where your coding agents read them (default: .claude/skills and .agents/skills)',
    )
    .option(
      '--agent <list>',
      `comma-separated: ${Object.keys(SKILL_TARGETS).join(', ')} (default ${DEFAULT_SKILL_TARGETS.join(',')})`,
    )
    .option('-g, --global', 'install into your home directory instead of the project')
    .option('--skill <names>', 'only these skills (comma-separated)')
    .option('--force', 'replace skills that are already installed')
    .action((opts, cmd) => {
      const ctx = createContext(cmd);
      const targets = parseList(opts.agent);
      const bad = targets.filter((t) => !(t in SKILL_TARGETS));
      if (bad.length)
        throw new SdodsError('CONFIG_INVALID', `Unknown agent ${bad.join(', ')}.`, {
          hint: `Use one or more of ${Object.keys(SKILL_TARGETS).join(', ')}.`,
          exitCode: 2,
        });
      let results;
      try {
        results = installSkills({
          rootDir: ctx.rootDir,
          targets: targets as SkillTarget[],
          global: opts.global === true,
          skills: parseList(opts.skill),
          force: opts.force === true,
        });
      } catch (e) {
        throw new SdodsError('CONFIG_INVALID', (e as Error).message, { exitCode: 2 });
      }
      if (ctx.opts.json) return json(results);
      const base = opts.global ? (process.env.HOME ?? '') : ctx.rootDir;
      for (const r of results) {
        const where = relative(base, r.path) || r.path;
        if (r.status === 'skipped')
          out(pc.dim(`- ${where} (already installed; --force replaces it)`));
        else ok(`${r.status === 'replaced' ? 'Replaced' : 'Installed'} ${where}`);
      }
      info('Restart or reload your agent so it picks the skills up.');
    });
}
