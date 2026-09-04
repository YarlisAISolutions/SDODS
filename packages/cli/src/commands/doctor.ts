import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import { collectVarRefs, loadDotEnvLayer, loadEnvFile } from '@automax/core';
import { createContext } from '../context.js';
import { json, out } from '../ui.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  /** optional checks never fail the command */
  optional?: boolean;
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Check Node, Bun, browsers, projects, env vars and database reachability')
    .option('-p, --project <slug>', 'limit env-var checks to one project')
    .option('--fix', 'install missing browsers')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const checks: Check[] = [];

      const nodeMajor = Number(process.versions.node.split('.')[0]);
      checks.push({
        name: 'node',
        ok: nodeMajor >= 22,
        detail: `v${process.versions.node}`,
        fix: 'Install Node 22 LTS (nvm use 22).',
      });
      checks.push(
        await versionCheck('bun', ['--version'], 'optional: bun install/build are faster'),
      );
      checks.push(
        await versionCheck(
          'npx playwright',
          ['playwright', '--version'],
          'npm i -D @playwright/test',
          'npx',
        ),
      );

      const browsers = await browserCheck();
      checks.push(...browsers);
      if (opts.fix && browsers.some((b) => !b.ok)) {
        out(pc.cyan('Installing browsers…'));
        await execa('npx', ['playwright', 'install', '--with-deps'], {
          stdio: 'inherit',
          cwd: ctx.rootDir,
        }).catch(() => undefined);
      }

      const entries = opts.project
        ? [ctx.registry.entry(opts.project)]
        : ctx.registry.entriesList();
      checks.push({
        name: 'projects',
        ok: entries.length > 0,
        detail: entries.map((e) => e.slug).join(', ') || 'none',
        fix: 'automax project create <slug>',
      });
      for (const e of entries) {
        for (const envName of e.config.envs.available) {
          const file = join(e.root, 'envs', `${envName}.yaml`);
          if (!existsSync(file)) {
            checks.push({
              name: `${e.slug}/${envName}`,
              ok: false,
              detail: 'env yaml missing',
              fix: `automax env add ${envName} -p ${e.slug} --ui-url ... --api-url ...`,
            });
            continue;
          }
          const envCfg = loadEnvFile(e.root, envName);
          const refs = collectVarRefs(envCfg);
          const dotenv = loadDotEnvLayer(ctx.rootDir, e.root, envName).values;
          const missing = [...refs].filter(
            (v) => dotenv[v] === undefined && process.env[v] === undefined,
          );
          checks.push({
            name: `${e.slug}/${envName} vars`,
            ok: missing.length === 0,
            detail: missing.length
              ? `missing: ${missing.join(', ')}`
              : `${refs.size} var(s) resolved`,
            fix: missing.length
              ? `Add ${missing.join(', ')} to ${join(e.root, `.env.${envName}`)}`
              : undefined,
          });
        }
      }

      const driver = process.env.DB_DRIVER ?? 'sqlite';
      checks.push({
        name: 'database',
        ok: driver === 'sqlite' || Boolean(process.env.DATABASE_URL),
        detail:
          driver === 'sqlite'
            ? `sqlite (${process.env.SQLITE_PATH ?? '.automax/automax.db'})`
            : `postgres ${process.env.DATABASE_URL ? '(url set)' : '(DATABASE_URL missing)'}`,
        fix: 'Set DB_DRIVER=sqlite or provide DATABASE_URL.',
      });

      // Coding-agent CLIs (optional: they let agents run on your existing login instead of an API key)
      const cliStatus = await codingCliStatus();
      for (const c of cliStatus) checks.push(c);

      const tokens = tokenMatrix(cliStatus);

      if (ctx.opts.json) return json({ checks, tokens });
      for (const c of checks) {
        out(
          `${c.ok ? pc.green('✔') : pc.red('✖')} ${c.name.padEnd(28)} ${c.detail}${!c.ok && c.fix ? pc.dim(`  → ${c.fix}`) : ''}`,
        );
      }
      out(pc.bold('\nTokens and keys'));
      for (const t of tokens) {
        const icon = t.present
          ? pc.green('✔')
          : t.requirement === 'mandatory'
            ? pc.red('✖')
            : t.requirement === 'one-of' && !t.groupSatisfied
              ? pc.yellow('!')
              : pc.dim('·');
        out(
          `${icon} ${t.name.padEnd(36)} ${pc.dim(t.requirement.padEnd(10))} ${t.detail}${t.hint && !t.present ? pc.dim(`  → ${t.hint}`) : ''}`,
        );
      }
      out(
        pc.dim(
          '\nNothing is mandatory for the platform itself (AutoMax API tokens are self-issued and free). Agents need one of the "one-of" rows.',
        ),
      );
      const blocking = checks.some((c) => !c.ok && !c.optional);
      if (blocking) process.exitCode = 1;
    });
}

type Requirement = 'mandatory' | 'one-of' | 'optional' | 'ci-only';

interface TokenRow {
  name: string;
  requirement: Requirement;
  group?: string;
  present: boolean;
  groupSatisfied?: boolean;
  detail: string;
  hint?: string;
}

/**
 * The token matrix. "one-of" rows form a group: agents need ANY one of them.
 * Platform features never need an external token.
 */
function tokenMatrix(cliStatus: Check[]): TokenRow[] {
  const has = (k: string) => Boolean(process.env[k]);
  const claudeOk = cliStatus.find((c) => c.name === 'cli:claude')?.ok ?? false;
  const codexOk = cliStatus.find((c) => c.name === 'cli:codex')?.ok ?? false;
  const agentsGroup = [
    {
      name: 'ANTHROPIC_API_KEY',
      present: has('ANTHROPIC_API_KEY'),
      detail: 'Claude via the Agent SDK / Messages API (billed by Anthropic)',
      hint: 'or log in to Claude Code (`claude login`) — no key needed',
    },
    {
      name: 'claude CLI login',
      present: claudeOk,
      detail: 'adapter claude-code: uses your Claude Code login (subscription or key)',
      hint: '`npm i -g @anthropic-ai/claude-code && claude login`',
    },
    {
      name: 'codex CLI login',
      present: codexOk,
      detail: 'adapter codex: uses your Codex login (ChatGPT account)',
      hint: '`npm i -g @openai/codex && codex login`',
    },
    {
      name: 'OPENAI_API_KEY (+OPENAI_BASE_URL)',
      present: has('OPENAI_API_KEY'),
      detail: 'any OpenAI-compatible chat-completions endpoint',
      hint: 'optional OPENAI_BASE_URL for Azure/Ollama/others',
    },
  ];
  const groupSatisfied = agentsGroup.some((g) => g.present);
  const rows: TokenRow[] = agentsGroup.map((g) => ({
    ...g,
    requirement: 'one-of' as const,
    group: 'agents',
    groupSatisfied,
  }));
  const serve = process.argv.includes('serve');
  rows.push(
    {
      name: 'SESSION_SECRET',
      requirement: serve ? 'mandatory' : 'optional',
      present: has('SESSION_SECRET'),
      detail: 'web server session signing (≥32 chars); needed only for `automax serve`',
      hint: 'generate: `openssl rand -hex 32`',
    },
    {
      name: 'DATABASE_URL',
      requirement: process.env.DB_DRIVER === 'postgres' ? 'mandatory' : 'optional',
      present: has('DATABASE_URL'),
      detail: 'only when DB_DRIVER=postgres (SQLite needs nothing)',
    },
    {
      name: 'GITHUB_TOKEN',
      requirement: 'optional',
      present: has('GITHUB_TOKEN'),
      detail: 'GitHub check runs, PR comments, issues (integrations.github)',
    },
    {
      name: 'JIRA_EMAIL + JIRA_API_TOKEN',
      requirement: 'optional',
      present: has('JIRA_EMAIL') && has('JIRA_API_TOKEN'),
      detail: 'Jira issues, links, transitions (integrations.jira)',
    },
    {
      name: 'AUTOMAX_TOKEN (+AUTOMAX_SERVER_URL)',
      requirement: 'optional',
      present: has('AUTOMAX_TOKEN'),
      detail: 'self-issued, free: MCP over HTTP and CI result ingest (`automax tokens create`)',
    },
    {
      name: 'FIREBASE_SERVICE_ACCOUNT_AUTOMAX_DOCS',
      requirement: 'ci-only',
      present: has('FIREBASE_SERVICE_ACCOUNT_AUTOMAX_DOCS'),
      detail: 'GitHub secret for the docs deploy workflow',
    },
    {
      name: 'NPM_TOKEN',
      requirement: 'ci-only',
      present: has('NPM_TOKEN'),
      detail: 'GitHub secret for publishing @automax/* packages',
    },
  );
  return rows;
}

/** `cli:claude` / `cli:codex` rows: installed + logged in. Missing CLIs are not failures. */
async function codingCliStatus(): Promise<Check[]> {
  const rows: Check[] = [];
  try {
    const { ClaudeCodeCliAdapter, CodexCliAdapter } = await import('@automax/agents');
    const c = ClaudeCodeCliAdapter.loginStatus();
    rows.push({
      name: 'cli:claude',
      ok: c.installed && c.loggedIn !== false,
      optional: true,
      detail: c.detail,
      fix: c.installed ? 'claude login' : 'npm i -g @anthropic-ai/claude-code (optional)',
    });
    const x = CodexCliAdapter.loginStatus();
    rows.push({
      name: 'cli:codex',
      ok: x.installed && x.loggedIn !== false,
      optional: true,
      detail: x.detail,
      fix: x.installed ? 'codex login' : 'npm i -g @openai/codex (optional)',
    });
  } catch {
    rows.push({
      name: 'cli:claude',
      ok: false,
      optional: true,
      detail: 'agents package unavailable',
    });
    rows.push({
      name: 'cli:codex',
      ok: false,
      optional: true,
      detail: 'agents package unavailable',
    });
  }
  return rows;
}

async function versionCheck(name: string, args: string[], fix: string, bin = name): Promise<Check> {
  try {
    const { stdout } = await execa(bin, args, { timeout: 20_000 });
    return { name, ok: true, detail: stdout.trim().split('\n')[0] ?? '' };
  } catch {
    return { name, ok: false, detail: 'not found', fix };
  }
}

async function browserCheck(): Promise<Check[]> {
  const out: Check[] = [];
  for (const b of ['chromium', 'firefox', 'webkit'] as const) {
    try {
      const mod = await import('playwright-core');
      const path = (mod as any)[b].executablePath() as string;
      out.push({
        name: `browser:${b}`,
        ok: existsSync(path),
        detail: existsSync(path) ? path : 'not installed',
        fix: `npx playwright install ${b}`,
      });
    } catch {
      out.push({
        name: `browser:${b}`,
        ok: false,
        detail: 'playwright-core not resolvable',
        fix: 'npm i -D @playwright/test',
      });
    }
  }
  return out;
}
