import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import pc from 'picocolors';
import { AutomaxError, DEFAULT_ARTIFACTS_DIR, Logger } from '@automax/core';
import { createContext } from '../context.js';
import { json, ok, out, table, warn } from '../ui.js';

const LINKS_FILE = ['.automax', 'issue-links.json'] as const;

/** `automax integrations test|notify|sync|links` — GitHub and Jira without the server or a database. */
export function register(program: Command) {
  const cmd = program
    .command('integrations')
    .description('GitHub and Jira: test connectivity, notify runs, sync issue links');

  cmd
    .command('test')
    .description('Check credentials and reachability for each enabled provider')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--provider <name>', 'only this provider (github|jira)')
    .action(async (opts, c) => {
      const ctx = createContext(c);
      const entry = ctx.registry.entry(opts.project);
      const { getProviders } = await import('@automax/integrations');
      const providers = await getProviders(entry.config, {
        only: opts.provider ? [opts.provider] : undefined,
        projectRoot: entry.root,
      });
      const rows: Array<Record<string, unknown>> = [];
      for (const p of providers) {
        if (!p.enabled) {
          rows.push({
            provider: p.name,
            enabled: false,
            ok: '-',
            detail: 'disabled in automax.project.yaml',
            secrets: fmtSecrets(p.secrets),
          });
          continue;
        }
        if (p.initError) {
          rows.push({
            provider: p.name,
            enabled: true,
            ok: false,
            detail: p.initError,
            secrets: fmtSecrets(p.secrets),
          });
          continue;
        }
        const res = await p.provider.test();
        rows.push({
          provider: p.name,
          enabled: true,
          ok: res.ok,
          detail: res.detail,
          secrets: fmtSecrets(p.secrets),
        });
      }
      if (ctx.opts.json) return json(rows);
      if (!rows.length) return warn('No integrations configured for this project.');
      table(
        rows.map((r) => ({
          ...r,
          ok: r.ok === true ? pc.green('ok') : r.ok === false ? pc.red('FAIL') : pc.dim('-'),
        })),
      );
      if (rows.some((r) => r.ok === false)) process.exitCode = 1;
    });

  cmd
    .command('notify')
    .description(
      'Publish a run to enabled providers: check runs, PR comment, issues (deduplicated)',
    )
    .requiredOption('--run-id <id>', 'run id (directory under the artifacts dir)')
    .option('-p, --project <slug>', 'project slug (default: from run.json)')
    .option(
      '--from-files',
      'build the summary from the run directory (default until DB ingest lands)',
    )
    .option('--provider <name>', 'only this provider')
    .option('--dry-run', 'print what would be created without calling any API')
    .option('--report-url <url>', 'public report URL to include in comments and issues')
    .option('--artifacts-dir <dir>', 'artifacts root', DEFAULT_ARTIFACTS_DIR)
    .action(async (opts, c) => {
      const ctx = createContext(c);
      const {
        buildRunSummaryFromFiles,
        getProviders,
        createIntegrationContext,
        FileIssueLinkStore,
      } = await import('@automax/integrations');
      const artifactsRoot = join(ctx.rootDir, opts.artifactsDir);
      const runDir = join(artifactsRoot, opts.runId);
      if (!existsSync(runDir)) {
        throw new AutomaxError('RUN_FAILED', `Run directory not found: ${runDir}`, {
          hint: 'Pass --artifacts-dir or check the run id (automax report --last).',
          exitCode: 2,
        });
      }
      const summary = buildRunSummaryFromFiles(runDir, {
        projectSlug: opts.project,
        reportUrl: opts.reportUrl,
      });
      const slug = summary.run.projectSlug;
      const entry = ctx.registry.entry(slug);
      const providers = await getProviders(entry.config, {
        only: opts.provider ? [opts.provider] : undefined,
        projectRoot: entry.root,
      });
      const ictx = createIntegrationContext({
        store: new FileIssueLinkStore(join(ctx.rootDir, ...LINKS_FILE)),
        logger: new Logger('integrations'),
        dryRun: Boolean(opts.dryRun),
        artifactsRoot,
      });
      const results: Array<{
        provider: string;
        kind: string;
        target?: string;
        url?: string;
        detail?: string;
      }> = [];
      for (const p of providers) {
        if (!p.enabled) continue;
        if (p.initError) {
          results.push({ provider: p.name, kind: 'skipped', detail: p.initError });
          continue;
        }
        try {
          const res = await p.provider.onRunFinished(summary, ictx);
          results.push(...res.actions);
        } catch (e) {
          results.push({ provider: p.name, kind: 'error', detail: (e as Error).message });
        }
      }
      if (ctx.opts.json)
        return json({ run: summary.run, totals: summary.totals, actions: results });
      const t = summary.totals;
      out(
        pc.bold(
          `Run ${summary.run.id} · ${slug} · ${summary.run.env} · ${t.passed}/${t.total} passed, ${t.failed} failed, ${t.flaky} flaky`,
        ) + (opts.dryRun ? pc.yellow('  [dry-run]') : ''),
      );
      if (!results.length) return warn('No enabled providers produced actions.');
      table(
        results.map((r) => ({
          provider: r.provider,
          action: r.kind,
          target: r.target ?? '',
          url: r.url ?? '',
          detail: r.detail ?? '',
        })),
      );
      if (results.some((r) => r.kind === 'error')) process.exitCode = 1;
    });

  cmd
    .command('sync')
    .description('Scan features for @jira:KEY / @github:N tags, create links, and refresh statuses')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--provider <name>', 'only this provider')
    .action(async (opts, c) => {
      const ctx = createContext(c);
      const entry = ctx.registry.entry(opts.project);
      const { getProviders, FileIssueLinkStore } = await import('@automax/integrations');
      const { fingerprint } = await import('@automax/contracts');
      const store = new FileIssueLinkStore(join(ctx.rootDir, ...LINKS_FILE));
      const providers = await getProviders(entry.config, {
        only: opts.provider ? [opts.provider] : undefined,
        projectRoot: entry.root,
      });
      const tagged = scanFeatureTags(join(entry.root, 'features'), entry.root);
      const rows: Array<Record<string, unknown>> = [];
      for (const p of providers) {
        if (!p.enabled) continue;
        if (p.initError) {
          warn(`${p.name}: ${p.initError}`);
          continue;
        }
        const tagName = p.name === 'jira' || p.name === 'github' ? p.name : null;
        if (tagName) {
          for (const t of tagged.filter((x) => x.tag === tagName)) {
            const fp = fingerprint({
              project: entry.slug,
              featureUri: t.featureUri,
              scenarioName: t.scenarioName,
              exampleIndex: null,
              layer: t.layer,
            });
            if (await store.findByKey(entry.slug, p.name, t.key)) continue;
            try {
              const ref = await p.provider.linkIssue(fp, t.key);
              await store.save({
                projectSlug: entry.slug,
                provider: p.name,
                fingerprint: fp,
                scenarioName: t.scenarioName,
                externalKey: ref.key,
                externalUrl: ref.url,
                status: ref.status,
                source: 'tag',
                lastSyncedAt: new Date().toISOString(),
              });
            } catch (e) {
              warn(`${p.name}: cannot link ${t.key}: ${(e as Error).message}`);
            }
          }
        }
        const links = await store.list(entry.slug, p.name);
        const refs = await p.provider.syncStatuses(links);
        for (const ref of refs) {
          const link = links.find((l) => l.externalKey === ref.key);
          if (!link) continue;
          await store.save({
            ...link,
            status: ref.status,
            closedAt:
              ref.status === 'closed' && link.status !== 'closed'
                ? new Date().toISOString()
                : link.closedAt,
            lastSyncedAt: new Date().toISOString(),
          });
          rows.push({
            provider: p.name,
            key: ref.key,
            status: ref.status,
            scenario: link.scenarioName,
            source: link.source,
            url: ref.url,
          });
        }
      }
      if (ctx.opts.json) return json(rows);
      if (!rows.length) return ok('Nothing to sync (no enabled providers or no links).');
      table(rows);
    });

  cmd
    .command('links')
    .description('List known issue links for a project')
    .requiredOption('-p, --project <slug>', 'project slug')
    .option('--provider <name>', 'only this provider')
    .action(async (opts, c) => {
      const ctx = createContext(c);
      ctx.registry.entry(opts.project);
      const { FileIssueLinkStore } = await import('@automax/integrations');
      const store = new FileIssueLinkStore(join(ctx.rootDir, ...LINKS_FILE));
      const links = await store.list(opts.project, opts.provider);
      if (ctx.opts.json) return json(links);
      table(
        links.map((l) => ({
          provider: l.provider,
          key: l.externalKey,
          status: l.status,
          source: l.source,
          scenario: l.scenarioName,
          lastRun: l.lastRunId ?? '',
          synced: l.lastSyncedAt ?? '',
        })),
      );
    });
}

function fmtSecrets(s: Record<string, boolean>): string {
  return Object.entries(s)
    .map(([k, v]) => `${k}=${v ? pc.green('set') : pc.red('missing')}`)
    .join(' ');
}

interface TaggedScenario {
  tag: 'jira' | 'github';
  key: string;
  featureUri: string;
  scenarioName: string;
  layer: string;
}

/** Lightweight feature scan for issue tags (feature-level tags inherit to scenarios). */
export function scanFeatureTags(featuresDir: string, projectRoot: string): TaggedScenario[] {
  const out: TaggedScenario[] = [];
  if (!existsSync(featuresDir)) return out;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.feature')) files.push(p);
    }
  };
  walk(featuresDir);
  for (const file of files) {
    const featureUri = file.slice(projectRoot.length + 1).replace(/\\/g, '/');
    let featureTags: string[] = [];
    let pending: string[] = [];
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('@')) {
        pending.push(...line.split(/\s+/).filter((t) => t.startsWith('@')));
        continue;
      }
      if (/^Feature:/.test(line)) {
        featureTags = pending;
        pending = [];
        continue;
      }
      const m = /^(?:Scenario(?: Outline| Template)?|Example):\s*(.+)$/.exec(line);
      if (!m) continue;
      const tags = [...featureTags, ...pending];
      pending = [];
      const layer = tags.includes('@api') ? 'api' : tags.includes('@hybrid') ? 'hybrid' : 'ui';
      for (const t of tags) {
        const jira = /^@jira:([A-Z][A-Z0-9]+-\d+)$/i.exec(t);
        const gh = /^@github:(\d+)$/.exec(t);
        if (jira)
          out.push({
            tag: 'jira',
            key: jira[1]!.toUpperCase(),
            featureUri,
            scenarioName: m[1]!.trim(),
            layer,
          });
        if (gh)
          out.push({ tag: 'github', key: gh[1]!, featureUri, scenarioName: m[1]!.trim(), layer });
      }
    }
  }
  return out;
}
