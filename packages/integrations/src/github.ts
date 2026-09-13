import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Octokit } from '@octokit/rest';
import type { RunRecord } from '@sdods/contracts';
import { artifactDisplayPath, gherkinBlock, selectIssueScreenshots, truncate } from './context.js';
import { IssueDedupe, fingerprintMarker, issueTitle } from './dedupe.js';
import type {
  CreateIssueInput,
  GitHubConfig,
  IntegrationContext,
  IntegrationProvider,
  IntegrationSecrets,
  IssueLink,
  IssueRef,
  NotifyAction,
  NotifyResult,
  ProviderTestOptions,
  ProviderTestResult,
  RunSummaryInput,
  ScenarioSummary,
} from './types.js';

export const PR_COMMENT_MARKER = '<!-- sdods:run-summary -->';
const ANNOTATION_BATCH = 50;
/** colour for labels created by `sdods integrations test --create-labels` */
const LABEL_COLOR = 'd93f0b';

export interface GitHubProviderOptions {
  baseUrl?: string;
  octokit?: Octokit;
}

export class GitHubProvider implements IntegrationProvider<GitHubConfig> {
  readonly name = 'github' as const;
  private config!: GitHubConfig;
  private octokit!: Octokit;
  private owner = '';
  private repo = '';

  constructor(private readonly options: GitHubProviderOptions = {}) {}

  async init(config: GitHubConfig, secrets: IntegrationSecrets): Promise<void> {
    this.config = config;
    const [envOwner, envRepo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
    this.owner = config.owner ?? envOwner ?? '';
    this.repo = config.repo ?? envRepo ?? '';
    if (!this.owner || !this.repo)
      throw new Error('GitHub integration needs owner and repo (or GITHUB_REPOSITORY).');
    if (!secrets.token && !this.options.octokit) {
      throw new Error(`GitHub integration needs a token in $${config.tokenEnv}.`);
    }
    this.octokit =
      this.options.octokit ??
      new Octokit({
        auth: secrets.token,
        baseUrl: this.options.baseUrl ?? process.env.GITHUB_API_URL,
        userAgent: 'sdods',
      });
  }

  async test(opts: ProviderTestOptions = {}): Promise<ProviderTestResult> {
    let detail: string;
    try {
      const { data } = await this.octokit.rest.repos.get({ owner: this.owner, repo: this.repo });
      detail = `repo ${data.full_name} reachable (${data.private ? 'private' : 'public'})`;
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
    return this.checkLabels(detail, opts);
  }

  /**
   * Issues are created with `labels`; a label the repository lacks is a configuration error that
   * nothing reported. Missing labels fail the test, and `createMissingLabels` creates them.
   */
  private async checkLabels(
    detail: string,
    opts: ProviderTestOptions,
  ): Promise<ProviderTestResult> {
    const wanted = [...new Set(this.config.labels ?? [])];
    if (!wanted.length) return { ok: true, detail };
    let existing: Array<{ name: string }>;
    try {
      existing = await this.octokit.paginate(this.octokit.rest.issues.listLabelsForRepo, {
        owner: this.owner,
        repo: this.repo,
        per_page: 100,
      });
    } catch (e) {
      return { ok: false, detail: `${detail}; cannot list labels: ${(e as Error).message}` };
    }
    const have = new Set(existing.map((l) => l.name.toLowerCase()));
    const missing = wanted.filter((l) => !have.has(l.toLowerCase()));
    if (!missing.length) return { ok: true, detail };
    if (!opts.createMissingLabels) {
      return {
        ok: false,
        detail: `${detail}; missing labels: ${missing.join(', ')} (create them, or run \`sdods integrations test --create-labels\`)`,
        labels: { missing, created: [] },
      };
    }
    const created: string[] = [];
    const failed: string[] = [];
    const errors: string[] = [];
    for (const name of missing) {
      try {
        await this.octokit.rest.issues.createLabel({
          owner: this.owner,
          repo: this.repo,
          name,
          color: LABEL_COLOR,
        });
        created.push(name);
      } catch (e) {
        failed.push(name);
        errors.push(`${name}: ${(e as Error).message}`);
      }
    }
    return {
      ok: failed.length === 0,
      detail: [
        detail,
        created.length ? `created labels: ${created.join(', ')}` : '',
        errors.length ? `cannot create labels: ${errors.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
      labels: { missing: failed, created },
    };
  }

  async onRunFinished(summary: RunSummaryInput, ctx: IntegrationContext): Promise<NotifyResult> {
    const actions: NotifyAction[] = [];
    const { run } = summary;

    if (this.config.checkRun && ctx.ci.provider === 'github' && ctx.ci.sha) {
      actions.push(...(await this.publishCheckRuns(summary, ctx)));
    }
    if (this.config.prComment && ctx.ci.isPullRequest && ctx.ci.prNumber) {
      actions.push(await this.upsertPrComment(summary, ctx));
    }

    const candidates = this.failuresToReport(summary);
    for (const scenario of candidates) {
      // The local link file does not survive a fresh CI runner, so an open issue carrying the
      // fingerprint marker is looked up in the repository before creating another one.
      const dedupe = new IssueDedupe(ctx.store, {
        findRemote: ctx.dryRun
          ? undefined
          : () => this.findOpenIssueByFingerprint(scenario, run, ctx),
      });
      const decision = await dedupe.decide(run.projectSlug, this.name, scenario.fingerprint);
      if (decision.action === 'create') {
        if (ctx.dryRun) {
          actions.push({
            provider: this.name,
            kind: 'issue-created',
            fingerprint: scenario.fingerprint,
            detail: `[dry-run] would create "${issueTitle(scenario.featureName, scenario.scenarioName, scenario.browser)}"`,
          });
          continue;
        }
        const ref = await this.createIssue(
          {
            projectSlug: run.projectSlug,
            run,
            scenario,
            screenshots: selectIssueScreenshots(scenario),
            reportUrl: summary.reportUrl,
          },
          ctx,
        );
        actions.push({
          provider: this.name,
          kind: 'issue-created',
          target: ref.key,
          url: ref.url,
          fingerprint: scenario.fingerprint,
        });
      } else if (decision.action === 'comment' && decision.link) {
        const link = decision.link;
        if (link.lastRunId === run.id) {
          // `sdods run` notifies, and a later `sdods integrations notify` for the same run must not
          // add a second "failed again" comment.
          actions.push({
            provider: this.name,
            kind: 'skipped',
            target: link.externalKey,
            fingerprint: scenario.fingerprint,
            detail: `run ${run.id} already reported on ${link.externalKey}`,
          });
          continue;
        }
        if (ctx.dryRun) {
          actions.push({
            provider: this.name,
            kind: 'issue-commented',
            target: link.externalKey,
            fingerprint: scenario.fingerprint,
            detail: '[dry-run] would comment "failed again"',
          });
          continue;
        }
        await this.octokit.rest.issues.createComment({
          owner: this.owner,
          repo: this.repo,
          issue_number: issueNumber(link.externalKey),
          body: `Failed again in run \`${run.id}\`${this.runLine(summary, ctx)}\n\n\`\`\`\n${truncate(scenario.errorMessage, 1500)}\n\`\`\``,
        });
        await ctx.store.save({ ...link, lastRunId: run.id });
        actions.push({
          provider: this.name,
          kind: 'issue-commented',
          target: link.externalKey,
          url: link.externalUrl,
          fingerprint: scenario.fingerprint,
        });
      } else {
        actions.push({
          provider: this.name,
          kind: 'skipped',
          fingerprint: scenario.fingerprint,
          detail: decision.reason,
        });
      }
    }

    // scenarios that now pass but have an open issue
    for (const scenario of summary.passed) {
      const link = await ctx.store.findOpen(run.projectSlug, this.name, scenario.fingerprint);
      if (!link || link.source === 'tag' || link.lastRunId === run.id) continue;
      const action = await this.onScenarioPassed(link, run, ctx);
      if (action) actions.push(action);
    }
    return { provider: this.name, actions };
  }

  /**
   * Search the repository for an open issue whose body carries this scenario's fingerprint marker
   * and record it as the scenario's link. A failed search falls back to the local links.
   */
  private async findOpenIssueByFingerprint(
    scenario: ScenarioSummary,
    run: RunRecord,
    ctx: IntegrationContext,
  ): Promise<IssueLink | undefined> {
    const marker = fingerprintMarker(scenario.fingerprint);
    try {
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `repo:${this.owner}/${this.repo} is:issue is:open in:body "${marker}"`,
        per_page: 10,
      });
      // search matches words, not the exact marker: confirm it in the body
      const exact = new RegExp(`${escapeRegExp(marker)}(?![\\w-])`);
      const hit = data.items.find(
        (i) => !i.pull_request && i.state === 'open' && exact.test(i.body ?? ''),
      );
      if (!hit) return undefined;
      return await ctx.store.save({
        projectSlug: run.projectSlug,
        provider: this.name,
        fingerprint: scenario.fingerprint,
        scenarioName: scenario.scenarioName,
        externalKey: `${this.owner}/${this.repo}#${hit.number}`,
        externalUrl: hit.html_url,
        status: 'open',
        source: 'auto',
        // the issue was opened by this very run (notified again from another machine)
        lastRunId: (hit.body ?? '').includes(`**Run** \`${run.id}\``) ? run.id : undefined,
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (e) {
      ctx.logger.warn(
        `github: searching issues for ${marker} failed, using local issue links only: ${(e as Error).message}`,
      );
      return undefined;
    }
  }

  private failuresToReport(summary: RunSummaryInput): ScenarioSummary[] {
    const mode = this.config.createIssueOnFailure;
    if (mode === 'never') return [];
    const seen = new Set<string>();
    return summary.failed.filter((s) => {
      if (seen.has(s.fingerprint)) return false;
      seen.add(s.fingerprint);
      return mode === 'always' || s.suiteTag === '@smoke';
    });
  }

  private runLine(summary: RunSummaryInput, ctx: IntegrationContext): string {
    const links: string[] = [];
    if (summary.reportUrl) links.push(`[report](${summary.reportUrl})`);
    if (ctx.ci.runUrl) links.push(`[CI run](${ctx.ci.runUrl})`);
    return links.length ? ` · ${links.join(' · ')}` : '';
  }

  private async publishCheckRuns(
    summary: RunSummaryInput,
    ctx: IntegrationContext,
  ): Promise<NotifyAction[]> {
    const actions: NotifyAction[] = [];
    const groups = new Map<string, ScenarioSummary[]>();
    for (const s of summary.scenarios) {
      const key = s.browser ?? s.layer;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [group, scenarios] of groups) {
      const failed = scenarios.filter((s) => s.status === 'failed' || s.status === 'timedOut');
      const flaky = scenarios.filter((s) => s.flaky);
      const name = `SDODS / ${summary.run.projectSlug} / ${group}`;
      const conclusion = failed.length ? 'failure' : 'success';
      const title = `${scenarios.length - failed.length}/${scenarios.length} passed${flaky.length ? `, ${flaky.length} flaky` : ''}`;
      const text = this.checkSummaryMarkdown(summary, scenarios, failed, flaky, ctx);
      const annotations = failed.map((s) => ({
        path: s.featureUri,
        start_line: s.line ?? 1,
        end_line: s.line ?? 1,
        annotation_level: 'failure' as const,
        title: s.scenarioName,
        message: truncate(s.errorMessage ?? 'failed', 1000) || 'failed',
      }));
      if (ctx.dryRun) {
        actions.push({
          provider: this.name,
          kind: 'check-run',
          target: name,
          detail: `[dry-run] ${conclusion}: ${title}, ${annotations.length} annotation(s)`,
        });
        continue;
      }
      const first = annotations.slice(0, ANNOTATION_BATCH);
      const { data } = await this.octokit.rest.checks.create({
        owner: this.owner,
        repo: this.repo,
        name,
        head_sha: ctx.ci.sha!,
        status: 'completed',
        conclusion,
        details_url: summary.reportUrl ?? ctx.ci.runUrl,
        output: { title, summary: text, annotations: first },
      });
      for (let i = ANNOTATION_BATCH; i < annotations.length; i += ANNOTATION_BATCH) {
        await this.octokit.rest.checks.update({
          owner: this.owner,
          repo: this.repo,
          check_run_id: data.id,
          output: { title, summary: text, annotations: annotations.slice(i, i + ANNOTATION_BATCH) },
        });
      }
      actions.push({
        provider: this.name,
        kind: 'check-run',
        target: name,
        url: data.html_url ?? undefined,
        detail: `${conclusion}: ${title}`,
      });
    }
    return actions;
  }

  private checkSummaryMarkdown(
    summary: RunSummaryInput,
    scenarios: ScenarioSummary[],
    failed: ScenarioSummary[],
    flaky: ScenarioSummary[],
    ctx: IntegrationContext,
  ): string {
    const t = summary.totals;
    const lines = [
      `| total | passed | failed | skipped | flaky | duration |`,
      `|---|---|---|---|---|---|`,
      `| ${scenarios.length} | ${scenarios.length - failed.length} | ${failed.length} | ${scenarios.filter((s) => s.status === 'skipped').length} | ${flaky.length} | ${formatMs(t.durationMs)} |`,
      '',
    ];
    if (failed.length) {
      lines.push('**Failed**');
      for (const s of failed)
        lines.push(
          `- \`${s.featureUri}\` › ${s.scenarioName}${s.errorMessage ? ` — ${firstLine(s.errorMessage)}` : ''}`,
        );
      lines.push('');
    }
    if (flaky.length) {
      lines.push('**Flaky (passed on retry)**');
      for (const s of flaky) lines.push(`- ${s.scenarioName}`);
      lines.push('');
    }
    const line = this.runLine(summary, ctx);
    if (line) lines.push(`Run \`${summary.run.id}\`${line}`);
    return lines.join('\n');
  }

  private async upsertPrComment(
    summary: RunSummaryInput,
    ctx: IntegrationContext,
  ): Promise<NotifyAction> {
    const prNumber = ctx.ci.prNumber!;
    const t = summary.totals;
    const status = t.failed ? '❌' : '✅';
    const body = [
      PR_COMMENT_MARKER,
      `### ${status} SDODS · ${summary.run.projectSlug} · ${summary.run.env}`,
      '',
      `| total | passed | failed | skipped | flaky | duration |`,
      `|---|---|---|---|---|---|`,
      `| ${t.total} | ${t.passed} | ${t.failed} | ${t.skipped} | ${t.flaky} | ${formatMs(t.durationMs)} |`,
      '',
      ...(summary.failed.length
        ? [
            '<details><summary>Failed scenarios</summary>',
            '',
            ...summary.failed.map(
              (s) =>
                `- \`${s.runnerProject}\` ${s.featureName} › ${s.scenarioName}${s.errorMessage ? `<br/><code>${escapeHtml(firstLine(s.errorMessage))}</code>` : ''}`,
            ),
            '',
            '</details>',
            '',
          ]
        : []),
      `Run \`${summary.run.id}\`${this.runLine(summary, ctx)}`,
    ].join('\n');
    if (ctx.dryRun)
      return {
        provider: this.name,
        kind: 'pr-comment',
        target: `#${prNumber}`,
        detail: '[dry-run] would upsert PR comment',
      };
    const existing = await this.octokit.paginate(this.octokit.rest.issues.listComments, {
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      per_page: 100,
    });
    const mine = existing.find((c) => c.body?.includes(PR_COMMENT_MARKER));
    if (mine) {
      const { data } = await this.octokit.rest.issues.updateComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: mine.id,
        body,
      });
      return {
        provider: this.name,
        kind: 'pr-comment',
        target: `#${prNumber}`,
        url: data.html_url,
        detail: 'updated',
      };
    }
    const { data } = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: prNumber,
      body,
    });
    return {
      provider: this.name,
      kind: 'pr-comment',
      target: `#${prNumber}`,
      url: data.html_url,
      detail: 'created',
    };
  }

  async createIssue(input: CreateIssueInput, ctx: IntegrationContext): Promise<IssueRef> {
    const { scenario, run } = input;
    const title = issueTitle(scenario.featureName, scenario.scenarioName, scenario.browser);
    const shotLines: string[] = [];
    for (const shot of input.screenshots) {
      let url = ctx.artifactUrl(shot, run);
      if (this.config.uploadToRelease) {
        const uploaded = await this.uploadReleaseAsset(shot, run, ctx).catch(() => null);
        if (uploaded) url = uploaded;
      }
      if (url)
        shotLines.push(
          `- ${shot.phase ?? 'screenshot'}${shot.stepIndex != null ? ` (step ${shot.stepIndex})` : ''}: ${url.endsWith('.png') ? `![${shot.phase}](${url})` : url}`,
        );
    }
    const body = [
      `**Project** \`${run.projectSlug}\` · **Environment** \`${run.env}\` · **Browser** \`${scenario.browser ?? scenario.layer}\` · **Run** \`${run.id}\``,
      run.gitSha
        ? `**Commit** \`${run.gitSha.slice(0, 10)}\`${run.gitBranch ? ` on \`${run.gitBranch}\`` : ''}`
        : '',
      '',
      '### Scenario',
      '```gherkin',
      gherkinBlock(scenario),
      '```',
      '',
      '### Error',
      '```',
      truncate(scenario.errorMessage ?? 'no error message', 3000),
      '```',
      '',
      ...(shotLines.length ? ['### Screenshots', ...shotLines, ''] : []),
      ...(await this.mediaLines(scenario, run, ctx)),
      ...(input.reportUrl || ctx.ci.runUrl
        ? [
            '### Links',
            ...(input.reportUrl ? [`- Report: ${input.reportUrl}`] : []),
            ...(ctx.ci.runUrl ? [`- CI run: ${ctx.ci.runUrl}`] : []),
            '',
          ]
        : []),
      `<!-- ${fingerprintMarker(scenario.fingerprint)} -->`,
      `<sub>${fingerprintMarker(scenario.fingerprint)}</sub>`,
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    const { data } = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      labels: this.config.labels,
    });
    const ref: IssueRef = {
      provider: this.name,
      key: `${this.owner}/${this.repo}#${data.number}`,
      url: data.html_url,
      status: 'open',
    };
    await ctx.store.save({
      projectSlug: input.projectSlug,
      provider: this.name,
      fingerprint: scenario.fingerprint,
      scenarioName: scenario.scenarioName,
      externalKey: ref.key,
      externalUrl: ref.url,
      status: 'open',
      source: 'auto',
      lastRunId: run.id,
      lastSyncedAt: new Date().toISOString(),
    });
    return ref;
  }

  /** Link the runner's video.webm and trace.zip, with the command that opens the trace. */
  private async mediaLines(
    scenario: ScenarioSummary,
    run: RunRecord,
    ctx: IntegrationContext,
  ): Promise<string[]> {
    const lines: string[] = [];
    let traceTarget: string | undefined;
    const media = [
      ['Video', scenario.videoPath],
      ['Trace', scenario.tracePath],
    ] as const;
    for (const [label, relPath] of media) {
      if (!relPath) continue;
      const local = artifactDisplayPath(relPath, run);
      let url = ctx.artifactUrl({ relPath }, run);
      let uploaded: string | null = null;
      if (this.config.uploadToRelease) {
        uploaded = await this.uploadReleaseAsset({ relPath }, run, ctx).catch(() => null);
        if (uploaded) url = uploaded;
      }
      if (url && url !== ctx.ci.artifactUrl) lines.push(`- ${label}: ${url}`);
      else if (url) lines.push(`- ${label}: \`${local}\` in the [CI run artifacts](${url})`);
      else lines.push(`- ${label}: \`${local}\``);
      if (label === 'Trace') traceTarget = uploaded ?? local;
    }
    if (!lines.length) return [];
    return [
      '### Video and trace',
      ...lines,
      ...(traceTarget
        ? ['', '```bash', `npx playwright show-trace ${shellArg(traceTarget)}`, '```']
        : []),
      '',
    ];
  }

  private async uploadReleaseAsset(
    shot: { relPath: string; absPath?: string },
    run: RunRecord,
    ctx: IntegrationContext,
  ): Promise<string | null> {
    const file = ctx.artifactPath(shot, run);
    if (!file || !this.config.uploadToRelease) return null;
    const { data: release } = await this.octokit.rest.repos.getReleaseByTag({
      owner: this.owner,
      repo: this.repo,
      tag: this.config.uploadToRelease,
    });
    const name = `${run.id}-${basename(file)}`;
    const bytes = readFileSync(file);
    const { data } = await this.octokit.rest.repos.uploadReleaseAsset({
      owner: this.owner,
      repo: this.repo,
      release_id: release.id,
      name,
      data: bytes as unknown as string,
      headers: { 'content-type': contentTypeOf(file), 'content-length': bytes.length },
    });
    return data.browser_download_url;
  }

  async linkIssue(fingerprint: string, key: string): Promise<IssueRef> {
    const num = issueNumber(key);
    const { data } = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: num,
    });
    return {
      provider: this.name,
      key: `${this.owner}/${this.repo}#${num}`,
      url: data.html_url,
      status: data.state === 'closed' ? 'closed' : 'open',
    };
  }

  async syncStatuses(links: IssueLink[]): Promise<IssueRef[]> {
    const out: IssueRef[] = [];
    for (const link of links) {
      try {
        out.push(await this.linkIssue(link.fingerprint, link.externalKey));
      } catch {
        out.push({
          provider: this.name,
          key: link.externalKey,
          url: link.externalUrl,
          status: 'unknown',
        });
      }
    }
    return out;
  }

  async onScenarioPassed(
    link: IssueLink,
    run: RunRecord,
    ctx: IntegrationContext,
  ): Promise<NotifyAction | null> {
    const num = issueNumber(link.externalKey);
    const body = `Passing again in run \`${run.id}\`${ctx.ci.runUrl ? ` · [CI run](${ctx.ci.runUrl})` : ''}.`;
    if (ctx.dryRun)
      return {
        provider: this.name,
        kind: this.config.closeOnPass ? 'issue-closed' : 'issue-commented',
        target: link.externalKey,
        detail: '[dry-run]',
      };
    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: num,
      body,
    });
    if (this.config.closeOnPass) {
      await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: num,
        state: 'closed',
        state_reason: 'completed',
      });
      await ctx.store.save({
        ...link,
        status: 'closed',
        closedAt: new Date().toISOString(),
        lastRunId: run.id,
      });
      return {
        provider: this.name,
        kind: 'issue-closed',
        target: link.externalKey,
        url: link.externalUrl,
      };
    }
    await ctx.store.save({ ...link, lastRunId: run.id });
    return {
      provider: this.name,
      kind: 'issue-commented',
      target: link.externalKey,
      url: link.externalUrl,
      detail: 'passing again',
    };
  }
}

export function issueNumber(key: string): number {
  const m = /#?(\d+)$/.exec(key.trim());
  if (!m) throw new Error(`Cannot parse GitHub issue number from "${key}"`);
  return Number(m[1]);
}

function contentTypeOf(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webm':
      return 'video/webm';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

function formatMs(ms: number): string {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
