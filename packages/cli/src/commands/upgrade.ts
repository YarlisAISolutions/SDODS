import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';
import semver from 'semver';
import { VERSION } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table, warn } from '../ui.js';

export const AUTOMAX_PACKAGES = [
  '@automax/cli',
  '@automax/core',
  '@automax/contracts',
  '@automax/db',
  '@automax/mcp',
  '@automax/agents',
  '@automax/integrations',
  '@automax/server',
] as const;

export interface UpgradeRow {
  package: string;
  installed: string | null;
  latest: string | null;
  status: 'up-to-date' | 'outdated' | 'not-installed' | 'unavailable';
}

export function installedVersion(rootDir: string, pkg: string): string | null {
  const file = join(rootDir, 'node_modules', pkg, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')).version as string | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function latestVersion(
  pkg: string,
  fetchImpl: typeof fetch = fetch,
  registry = process.env.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org',
): Promise<string | null> {
  try {
    const res = await fetchImpl(`${registry.replace(/\/$/, '')}/${pkg}/latest`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: string };
    return body.version ?? null;
  } catch {
    return null;
  }
}

export async function checkUpgrades(
  rootDir: string,
  fetchImpl?: typeof fetch,
): Promise<UpgradeRow[]> {
  const rows = await Promise.all(
    AUTOMAX_PACKAGES.map(async (pkg): Promise<UpgradeRow> => {
      const installed = installedVersion(rootDir, pkg) ?? (pkg === '@automax/cli' ? VERSION : null);
      const latest = await latestVersion(pkg, fetchImpl);
      let status: UpgradeRow['status'];
      if (!latest) status = 'unavailable';
      else if (!installed) status = 'not-installed';
      else
        status =
          semver.valid(installed) && semver.lt(installed, latest) ? 'outdated' : 'up-to-date';
      return { package: pkg, installed, latest, status };
    }),
  );
  return rows;
}

export function register(program: Command) {
  program
    .command('upgrade')
    .description('Check the npm registry for newer @automax/* packages')
    .option('--apply', 'install the latest versions with the package manager')
    .option('--pm <manager>', 'bun | pnpm | npm (default: detected from lockfile)')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const rows = await checkUpgrades(ctx.rootDir);
      if (ctx.opts.json) return json(rows);
      table(
        rows.map((r) => ({
          package: r.package,
          installed: r.installed ?? pc.dim('—'),
          latest: r.latest ?? pc.dim('?'),
          status:
            r.status === 'outdated'
              ? pc.yellow(r.status)
              : r.status === 'up-to-date'
                ? pc.green(r.status)
                : pc.dim(r.status),
        })),
      );
      const outdated = rows.filter((r) => r.status === 'outdated');
      if (!outdated.length) {
        if (rows.every((r) => r.status === 'unavailable'))
          warn('Registry unreachable (offline?) — nothing compared.');
        else ok('Everything installed is up to date.');
        return;
      }
      if (!opts.apply) {
        out(
          pc.dim(
            `Run \`automax upgrade --apply\` to install ${outdated.map((r) => r.package).join(', ')}.`,
          ),
        );
        return;
      }
      const pm = opts.pm ?? detectPm(ctx.rootDir);
      const specs = outdated.map((r) => `${r.package}@${r.latest}`);
      const args =
        pm === 'bun'
          ? ['add', ...specs]
          : pm === 'pnpm'
            ? ['add', ...specs]
            : ['install', ...specs];
      const res = await execa(pm, args, { cwd: ctx.rootDir, stdio: 'inherit', reject: false });
      if (res.exitCode !== 0) process.exitCode = 1;
      else ok(`Upgraded ${specs.length} package(s) with ${pm}.`);
    });
}

export function detectPm(rootDir: string): 'bun' | 'pnpm' | 'npm' {
  if (existsSync(join(rootDir, 'bun.lock')) || existsSync(join(rootDir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(rootDir, 'pnpm-lock.yaml'))) return 'pnpm';
  return 'npm';
}
