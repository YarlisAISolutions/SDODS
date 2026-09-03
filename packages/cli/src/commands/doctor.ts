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

      if (ctx.opts.json) return json(checks);
      for (const c of checks) {
        out(
          `${c.ok ? pc.green('✔') : pc.red('✖')} ${c.name.padEnd(28)} ${c.detail}${!c.ok && c.fix ? pc.dim(`  → ${c.fix}`) : ''}`,
        );
      }
      if (checks.some((c) => !c.ok)) process.exitCode = 1;
    });
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
