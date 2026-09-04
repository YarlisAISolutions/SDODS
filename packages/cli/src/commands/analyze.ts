import { resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { parse as parseYaml } from 'yaml';
import type { AnalysisReport, ProjectProposal } from '@automax/contracts';
import { ProjectConfigSchema } from '@automax/contracts';
import { createContext } from '../context.js';
import { heading, json, ok, out, table, warn } from '../ui.js';
import { projectTemplateFiles } from '../templates/project.js';

export interface InitFromAppOptions {
  appPath: string;
  rootDir: string;
  slug?: string;
  name?: string;
  openapi?: string;
  force?: boolean;
  importSpecs?: boolean;
  browsers?: string[];
}

/** Programmatic entry used by `automax init --from <app>`: analyze → propose → apply. */
export async function initFromApp(opts: InitFromAppOptions) {
  const { analyzeProject, proposeProject, applyProposal } = await import('@automax/core/analyze');
  const report = analyzeProject(opts.appPath, { openapi: opts.openapi });
  const proposal = proposeProject(report, {
    slug: opts.slug,
    name: opts.name,
    browsers: opts.browsers,
  });
  const result = applyProposal(proposal, {
    rootDir: opts.rootDir,
    scaffold: scaffoldFor(proposal),
    force: opts.force,
    appPath: opts.appPath,
    importSpecs: opts.importSpecs ?? true,
  });
  return { report, proposal, result };
}

/** Code/data scaffolding from the project template; the proposal owns yaml, envs and features. */
function scaffoldFor(proposal: ProjectProposal): Record<string, string> {
  const config = ProjectConfigSchema.parse(parseYaml(proposal.projectYaml));
  const files = projectTemplateFiles({
    config,
    envName: config.envs.default,
    uiUrl: '',
    apiUrl: '',
  });
  for (const key of Object.keys(files)) {
    if (key.startsWith('envs/') || key.startsWith('features/') || key === '.env.example') {
      delete files[key];
    }
  }
  return files;
}

export function register(program: Command) {
  program
    .command('analyze [path]')
    .description(
      'Analyze an application repository and propose an AutoMax project (read-only unless --apply)',
    )
    .option(
      '-p, --project <slug>',
      'slug for the proposed project (default: from the app directory)',
    )
    .option('--slug <slug>', 'alias of --project')
    .option('--name <name>', 'display name')
    .option('--openapi <file>', 'OpenAPI spec path relative to the app (auto-detected otherwise)')
    .option('--browsers <list>', 'comma list of browsers for the proposal', (v: string) =>
      v.split(',').map((s) => s.trim()),
    )
    .option('--apply', 'write the proposed project under projects/<slug>')
    .option('--force', 'overwrite an existing project when applying')
    .option('--no-import-specs', 'do not copy existing Playwright specs into recorded/imported')
    .option('--report-only', 'print the analysis, skip the proposal')
    .action(async (path: string | undefined, opts, cmd) => {
      const ctx = createContext(cmd);
      // the app path is relative to where the command was typed, not to --cwd (the AutoMax repo)
      const appPath = resolvePath(process.cwd(), path ?? '.');
      const { analyzeProject, proposeProject, applyProposal } =
        await import('@automax/core/analyze');
      const report = analyzeProject(appPath, { openapi: opts.openapi });
      const slug = opts.project ?? opts.slug;
      const proposal = opts.reportOnly
        ? undefined
        : proposeProject(report, { slug, name: opts.name, browsers: opts.browsers });

      let applied: ReturnType<typeof applyProposal> | undefined;
      if (opts.apply && proposal) {
        applied = applyProposal(proposal, {
          rootDir: ctx.rootDir,
          scaffold: scaffoldFor(proposal),
          force: opts.force,
          appPath,
          importSpecs: opts.importSpecs !== false,
        });
      }

      if (ctx.opts.json) {
        return json({
          report,
          proposal: proposal ? { ...proposal, files: undefined } : undefined,
          applied,
        });
      }

      printReport(report);
      if (proposal) printProposal(proposal);
      if (applied && proposal) {
        heading('Applied');
        ok(`Project ${proposal.slug} written to ${applied.root}`);
        for (const f of applied.written) out(`  ${f}`);
        if (applied.skipped.length) warn(`Skipped existing files: ${applied.skipped.join(', ')}`);
        if (applied.importedSpecs.length) {
          out(
            pc.dim(
              `  imported ${applied.importedSpecs.length} Playwright spec(s) into recorded/imported/`,
            ),
          );
        }
        const envName = Object.keys(proposal.envYamls)[0] ?? 'local';
        out(
          `\nNext:\n  automax lint -p ${proposal.slug}\n  automax run -p ${proposal.slug} -e ${envName} -l api\n  automax run -p ${proposal.slug} -e ${envName} -l ui -b chromium -t @smoke`,
        );
      } else if (proposal) {
        out(pc.dim('\nRun again with --apply to write the project.'));
      }
    });
}

function printReport(r: AnalysisReport) {
  heading(`Analysis of ${r.appPath}`);
  out(pc.dim(`${r.filesScanned} files scanned · ${r.analyzedAt}`));
  const mono = r.packageManager.monorepo
    ? ` (monorepo: ${r.packageManager.workspaces.join(', ') || 'yes'})`
    : '';
  out(`${pc.bold('Package manager')}   ${r.packageManager.name}${mono}`);
  out(
    `${pc.bold('Frameworks')}        ${
      r.frameworks
        .map(
          (f) =>
            `${f.name}${f.version ? ` ${f.version}` : ''} (${Math.round(f.confidence * 100)}%)`,
        )
        .join(', ') || pc.dim('none detected')
    }`,
  );
  out(
    `${pc.bold('Test-id attribute')} ${r.testIds.attribute ?? pc.dim('none')}${
      r.testIds.attribute ? ` (${r.testIds.counts[r.testIds.attribute]} uses)` : ''
    }`,
  );
  out(
    `${pc.bold('Auth')}              ${r.auth.strategyGuess}${
      r.auth.libraries.length ? ` via ${r.auth.libraries.join(', ')}` : ''
    }${r.auth.pages.length ? `; pages: ${r.auth.pages.join(', ')}` : ''}`,
  );
  out(`${pc.bold('Base URLs')}         ui ${r.baseUrls.ui ?? '?'} · api ${r.baseUrls.api ?? '?'}`);
  out(
    `${pc.bold('CI')}                ${r.ci.provider}${r.ci.files.length ? ` (${r.ci.files.length} file(s))` : ''}`,
  );
  if (r.i18n.libraries.length || r.i18n.locales.length) {
    out(
      `${pc.bold('i18n')}              ${r.i18n.libraries.join(', ')}${
        r.i18n.locales.length ? ` locales ${r.i18n.locales.join(', ')}` : ''
      }`,
    );
  }
  if (r.a11y.tooling.length) out(`${pc.bold('a11y tooling')}      ${r.a11y.tooling.join(', ')}`);

  const pages = r.routes.filter((x) => x.kind === 'page');
  const apis = r.routes.filter((x) => x.kind === 'api');
  heading(`Routes (${pages.length} pages, ${apis.length} API)`);
  table(
    r.routes.slice(0, 40).map((x) => ({
      kind: x.kind,
      method: x.method ?? '',
      path: x.path,
      source: x.source,
      file: `${x.file}${x.line ? `:${x.line}` : ''}`,
    })),
    ['kind', 'method', 'path', 'source', 'file'],
  );
  if (r.routes.length > 40) out(pc.dim(`  … ${r.routes.length - 40} more`));
  if (r.openapi.length) {
    heading('OpenAPI');
    for (const o of r.openapi) {
      out(`  ${o.file} — ${o.title ?? ''} ${o.version ?? ''} · ${o.endpoints.length} operations`);
    }
  }
  if (r.existingTests.length) {
    heading('Existing tests');
    table(
      r.existingTests.map((t) => ({
        framework: t.framework,
        files: t.files,
        css: t.locators.css,
        xpath: t.locators.xpath,
        role: t.locators.role,
        testId: t.locators.testId,
        text: t.locators.text,
      })),
    );
  }
  if (r.envs.length) {
    heading('Environment files');
    table(
      r.envs.map((e) => ({
        env: e.name,
        file: e.file,
        ui: e.uiBaseUrl ?? '',
        api: e.apiBaseUrl ?? '',
        vars: e.vars.length,
      })),
    );
  }
  heading('Checklist');
  for (const c of r.checklist) {
    const icon =
      c.severity === 'error'
        ? pc.red('✖')
        : c.severity === 'warning'
          ? pc.yellow('⚠')
          : pc.cyan('ℹ');
    out(`${icon} ${pc.bold(c.title)} — ${c.detail}${c.fix ? pc.dim(`\n    → ${c.fix}`) : ''}`);
  }
}

function printProposal(p: ProjectProposal) {
  heading(`Proposed project: ${p.slug}`);
  out(
    pc.dim(
      `envs: ${Object.keys(p.envYamls).join(', ')} · starter features: ${
        Object.keys(p.starterFeatures).length
      } · coverage targets: ${p.coverageMap.length}`,
    ),
  );
  for (const n of p.notes) warn(n);
  out(pc.dim('--- automax.project.yaml ---'));
  const lines = p.projectYaml.split('\n');
  out(lines.slice(0, 60).join('\n'));
  if (lines.length > 60) out(pc.dim('  …'));
  out(pc.dim('--- starter features ---'));
  for (const f of Object.keys(p.starterFeatures)) out(`  ${f}`);
}
