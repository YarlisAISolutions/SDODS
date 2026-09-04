import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { RunRecord } from '@sdods/contracts';
import { gherkinBlock, selectIssueScreenshots, truncate } from './context.js';
import { IssueDedupe, fingerprintMarker, issueTitle } from './dedupe.js';
import type {
  CreateIssueInput,
  IntegrationContext,
  IntegrationProvider,
  IntegrationSecrets,
  IssueLink,
  IssueRef,
  JiraConfig,
  NotifyAction,
  NotifyResult,
  ProviderTestResult,
  RunSummaryInput,
  ScenarioSummary,
} from './types.js';

export interface JiraProviderOptions {
  fetch?: typeof fetch;
}

type Adf = { type: string; [k: string]: unknown };

export class JiraProvider implements IntegrationProvider<JiraConfig> {
  readonly name = 'jira' as const;
  private config!: JiraConfig;
  private authHeader = '';
  private base = '';
  private readonly fetchImpl: typeof fetch;

  constructor(options: JiraProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async init(config: JiraConfig, secrets: IntegrationSecrets): Promise<void> {
    this.config = config;
    if (!config.baseUrl) throw new Error('Jira integration needs baseUrl.');
    if (!config.projectKey) throw new Error('Jira integration needs projectKey.');
    if (!secrets.token) throw new Error(`Jira integration needs a token in $${config.tokenEnv}.`);
    this.base = config.baseUrl.replace(/\/+$/, '');
    if (config.authMode === 'bearer') {
      this.authHeader = `Bearer ${secrets.token}`;
    } else {
      if (!secrets.email) throw new Error(`Jira basic auth needs an email in $${config.emailEnv}.`);
      this.authHeader = `Basic ${Buffer.from(`${secrets.email}:${secrets.token}`).toString('base64')}`;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        ...(isForm ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: isForm ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Jira ${method} ${path} → ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get('content-type') ?? '';
    return (ct.includes('json') ? await res.json() : await res.text()) as T;
  }

  async test(): Promise<ProviderTestResult> {
    try {
      const me = await this.request<{ displayName?: string; emailAddress?: string }>(
        'GET',
        '/rest/api/3/myself',
      );
      const project = await this.request<{ key: string; name: string }>(
        'GET',
        `/rest/api/3/project/${this.config.projectKey}`,
      );
      return {
        ok: true,
        detail: `authenticated as ${me.displayName ?? me.emailAddress ?? 'user'}; project ${project.key} (${project.name}) reachable`,
      };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }

  async onRunFinished(summary: RunSummaryInput, ctx: IntegrationContext): Promise<NotifyResult> {
    const actions: NotifyAction[] = [];
    const { run } = summary;
    const dedupe = new IssueDedupe(ctx.store);

    for (const scenario of this.failuresToReport(summary)) {
      let decision = await dedupe.decide(run.projectSlug, this.name, scenario.fingerprint);
      if (decision.action === 'create' && !ctx.dryRun) {
        // JQL fallback: an issue may exist that the local store does not know about.
        const found = await this.findByFingerprint(scenario.fingerprint).catch(() => null);
        if (found) {
          const link = await ctx.store.save({
            projectSlug: run.projectSlug,
            provider: this.name,
            fingerprint: scenario.fingerprint,
            scenarioName: scenario.scenarioName,
            externalKey: found.key,
            externalUrl: found.url,
            status: found.status,
            source: 'auto',
            lastRunId: run.id,
          });
          decision = { action: 'comment', link, reason: `found ${found.key} via JQL` };
        }
      }
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
        await this.comment(link.externalKey, [
          paragraph(`Failed again in run ${run.id}${ctx.ci.runUrl ? ` (${ctx.ci.runUrl})` : ''}.`),
          codeBlock(truncate(scenario.errorMessage ?? '', 1500) || 'no error message'),
        ]);
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

    if (this.config.linkTaggedScenarios) {
      for (const scenario of summary.scenarios) {
        for (const key of scenario.jiraKeys) {
          const existing = await ctx.store.findByKey(run.projectSlug, this.name, key);
          if (existing) continue;
          if (ctx.dryRun) {
            actions.push({
              provider: this.name,
              kind: 'skipped',
              target: key,
              detail: '[dry-run] would link tagged issue',
            });
            continue;
          }
          try {
            const ref = await this.linkIssue(scenario.fingerprint, key);
            await ctx.store.save({
              projectSlug: run.projectSlug,
              provider: this.name,
              fingerprint: scenario.fingerprint,
              scenarioName: scenario.scenarioName,
              externalKey: ref.key,
              externalUrl: ref.url,
              status: ref.status,
              source: 'tag',
              lastRunId: run.id,
              lastSyncedAt: new Date().toISOString(),
            });
          } catch (e) {
            ctx.logger.warn(`Cannot link ${key}: ${(e as Error).message}`);
          }
        }
      }
    }

    for (const scenario of summary.passed) {
      const link = await ctx.store.findOpen(run.projectSlug, this.name, scenario.fingerprint);
      if (!link) continue;
      const action = await this.onScenarioPassed(link, run, ctx);
      if (action) actions.push(action);
    }
    return { provider: this.name, actions };
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

  async findByFingerprint(fingerprint: string): Promise<IssueRef | null> {
    const jql = `project = ${this.config.projectKey} AND labels = sdods AND text ~ "${fingerprintMarker(fingerprint)}" AND statusCategory != Done ORDER BY created DESC`;
    const data = await this.request<{
      issues?: Array<{ key: string; fields?: { status?: { statusCategory?: { key?: string } } } }>;
    }>('POST', '/rest/api/3/search/jql', { jql, maxResults: 1, fields: ['status'] });
    const issue = data.issues?.[0];
    if (!issue) return null;
    return {
      provider: this.name,
      key: issue.key,
      url: this.browseUrl(issue.key),
      status: statusFromCategory(issue.fields?.status?.statusCategory?.key),
    };
  }

  async createIssue(input: CreateIssueInput, ctx: IntegrationContext): Promise<IssueRef> {
    const { scenario, run } = input;
    const content: Adf[] = [
      heading(`Scenario`, 3),
      codeBlock(gherkinBlock(scenario), 'gherkin'),
      heading('Error', 3),
      codeBlock(truncate(scenario.errorMessage ?? 'no error message', 3000)),
      heading('Context', 3),
      bullets([
        `Project: ${run.projectSlug} · Environment: ${run.env} · Browser: ${scenario.browser ?? scenario.layer}`,
        `Run: ${run.id}${run.gitSha ? ` · Commit ${run.gitSha.slice(0, 10)}` : ''}`,
        ...(input.reportUrl ? [`Report: ${input.reportUrl}`] : []),
        ...(ctx.ci.runUrl ? [`CI run: ${ctx.ci.runUrl}`] : []),
      ]),
      paragraph(fingerprintMarker(scenario.fingerprint)),
    ];
    const created = await this.request<{ key: string; id: string }>('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: this.config.projectKey },
        issuetype: { name: this.config.issueType },
        summary: issueTitle(scenario.featureName, scenario.scenarioName, scenario.browser),
        labels: this.config.labels,
        description: { type: 'doc', version: 1, content },
      },
    });
    await this.attachScreenshots(created.key, input, ctx);
    const ref: IssueRef = {
      provider: this.name,
      key: created.key,
      url: this.browseUrl(created.key),
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

  private async attachScreenshots(
    key: string,
    input: CreateIssueInput,
    ctx: IntegrationContext,
  ): Promise<void> {
    const capBytes = this.config.maxAttachmentMb * 1024 * 1024;
    let used = 0;
    const files: Array<{ path: string; name: string }> = [];
    for (const shot of input.screenshots) {
      const file = ctx.artifactPath(shot, input.run);
      if (!file) continue;
      const size = statSync(file).size;
      if (used + size > capBytes) break;
      used += size;
      files.push({
        path: file,
        name: `${shot.phase ?? 'shot'}${shot.stepIndex != null ? `-step${shot.stepIndex}` : ''}-${basename(file)}`,
      });
    }
    if (input.scenario.tracePath) {
      const file = ctx.artifactPath({ relPath: input.scenario.tracePath }, input.run);
      if (file && used + statSync(file).size <= capBytes)
        files.push({ path: file, name: `trace-${basename(file)}` });
    }
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) {
      form.append(
        'file',
        new Blob([readFileSync(f.path)], {
          type: f.name.endsWith('.zip') ? 'application/zip' : 'image/png',
        }),
        f.name,
      );
    }
    await this.request('POST', `/rest/api/3/issue/${key}/attachments`, form, {
      'X-Atlassian-Token': 'no-check',
    });
  }

  private async comment(key: string, content: Adf[]): Promise<void> {
    await this.request('POST', `/rest/api/3/issue/${key}/comment`, {
      body: { type: 'doc', version: 1, content },
    });
  }

  async linkIssue(_fingerprint: string, key: string): Promise<IssueRef> {
    const data = await this.request<{
      key: string;
      fields?: { status?: { statusCategory?: { key?: string } } };
    }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=status,summary`);
    return {
      provider: this.name,
      key: data.key,
      url: this.browseUrl(data.key),
      status: statusFromCategory(data.fields?.status?.statusCategory?.key),
    };
  }

  async syncStatuses(links: IssueLink[]): Promise<IssueRef[]> {
    const out: IssueRef[] = [];
    for (let i = 0; i < links.length; i += 50) {
      const batch = links.slice(i, i + 50);
      try {
        const data = await this.request<{
          issues?: Array<{
            key: string;
            fields?: { status?: { statusCategory?: { key?: string } } };
          }>;
        }>('POST', '/rest/api/3/search/jql', {
          jql: `key in (${batch.map((l) => l.externalKey).join(',')})`,
          maxResults: batch.length,
          fields: ['status'],
        });
        const byKey = new Map((data.issues ?? []).map((i) => [i.key, i] as const));
        for (const l of batch) {
          const issue = byKey.get(l.externalKey);
          out.push({
            provider: this.name,
            key: l.externalKey,
            url: l.externalUrl,
            status: issue
              ? statusFromCategory(issue.fields?.status?.statusCategory?.key)
              : 'unknown',
          });
        }
      } catch {
        for (const l of batch)
          out.push({
            provider: this.name,
            key: l.externalKey,
            url: l.externalUrl,
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
    if (ctx.dryRun)
      return {
        provider: this.name,
        kind: this.config.transitionOnPass ? 'transition' : 'issue-commented',
        target: link.externalKey,
        detail: '[dry-run]',
      };
    await this.comment(link.externalKey, [
      paragraph(`Passing again in run ${run.id}${ctx.ci.runUrl ? ` (${ctx.ci.runUrl})` : ''}.`),
    ]);
    if (this.config.transitionOnPass) {
      const data = await this.request<{ transitions?: Array<{ id: string; name: string }> }>(
        'GET',
        `/rest/api/3/issue/${link.externalKey}/transitions`,
      );
      const target = data.transitions?.find(
        (t) => t.name.toLowerCase() === this.config.transitionOnPass!.toLowerCase(),
      );
      if (target) {
        await this.request('POST', `/rest/api/3/issue/${link.externalKey}/transitions`, {
          transition: { id: target.id },
        });
        await ctx.store.save({
          ...link,
          status: 'closed',
          closedAt: new Date().toISOString(),
          lastRunId: run.id,
        });
        return {
          provider: this.name,
          kind: 'transition',
          target: link.externalKey,
          url: link.externalUrl,
          detail: `→ ${target.name}`,
        };
      }
      ctx.logger.warn(
        `Transition "${this.config.transitionOnPass}" not available on ${link.externalKey}`,
      );
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

  private browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }
}

function statusFromCategory(key: string | undefined): IssueRef['status'] {
  if (!key) return 'unknown';
  return key === 'done' ? 'closed' : 'open';
}

function paragraph(text: string): Adf {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}
function heading(text: string, level: number): Adf {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}
function codeBlock(text: string, language?: string): Adf {
  return {
    type: 'codeBlock',
    attrs: language ? { language } : {},
    content: [{ type: 'text', text: text || ' ' }],
  };
}
function bullets(items: string[]): Adf {
  return {
    type: 'bulletList',
    content: items.map((t) => ({ type: 'listItem', content: [paragraph(t)] })),
  };
}
