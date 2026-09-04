import type { Command } from 'commander';
import pc from 'picocolors';
import type { CoverageReport, CoverageRow } from '@automax/contracts';
import { createContext } from '../context.js';
import { heading, json, out, table } from '../ui.js';

export function register(program: Command) {
  program
    .command('coverage')
    .description('Route, endpoint and role coverage by scenarios, split by suite tag')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('-e, --env <name>', 'environment (for the OpenAPI spec and API base URL)')
    .option(
      '--openapi [file]',
      'include endpoints from the OpenAPI spec (env api.openapi or a file)',
    )
    .option('--routes', 'only routes')
    .option('--endpoints', 'only endpoints')
    .option('--roles', 'only roles')
    .option('--uncovered', 'only rows without scenarios')
    .action(async (opts, cmd) => {
      const ctx = createContext(cmd);
      const { computeCoverage } = await import('@automax/core/analyze');
      const report = computeCoverage(ctx.registry, opts.project, {
        env: opts.env,
        openapi: opts.openapi === true ? true : (opts.openapi ?? false),
      });
      if (ctx.opts.json) return json(report);
      printCoverage(report, opts);
      if (report.summary.uncoveredModules.length) process.exitCode = 1;
    });
}

function rows(list: CoverageRow[], suites: string[], onlyUncovered: boolean) {
  return list
    .filter((r) => !onlyUncovered || !r.covered)
    .map((r) => ({
      name: r.name,
      target: r.target,
      module: r.module ?? '',
      covered: r.covered ? pc.green('yes') : pc.red('no'),
      ...Object.fromEntries(suites.map((s) => [s, r.bySuite[s] ?? 0])),
      scenarios: r.scenarios.length,
    }));
}

function printCoverage(
  report: CoverageReport,
  opts: { routes?: boolean; endpoints?: boolean; roles?: boolean; uncovered?: boolean },
) {
  const all = !opts.routes && !opts.endpoints && !opts.roles;
  const s = report.summary;
  heading(`Coverage for ${report.project}`);
  out(
    `${pc.bold('routes')} ${s.routes.covered}/${s.routes.total}  ${pc.bold('endpoints')} ${s.endpoints.covered}/${s.endpoints.total}  ${pc.bold('roles')} ${s.roles.covered}/${s.roles.total}  ${pc.bold('scenarios')} ${s.scenarios}  ${pc.dim(
      Object.entries(s.bySuite)
        .map(([k, v]) => `${k}=${v}`)
        .join(' '),
    )}`,
  );
  const cols = ['name', 'target', 'module', 'covered', ...report.suites, 'scenarios'];
  if (all || opts.routes) {
    heading('Routes');
    table(rows(report.routes, report.suites, Boolean(opts.uncovered)), cols);
  }
  if (all || opts.endpoints) {
    heading('Endpoints');
    table(rows(report.endpoints, report.suites, Boolean(opts.uncovered)), cols);
  }
  if (all || opts.roles) {
    heading('Roles');
    table(rows(report.roles, report.suites, Boolean(opts.uncovered)), cols);
  }
  if (s.uncoveredModules.length) {
    out(`\n${pc.yellow('⚠')} Modules without any covered target: ${s.uncoveredModules.join(', ')}`);
  }
}
