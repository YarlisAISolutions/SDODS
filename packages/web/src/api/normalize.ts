/**
 * Adapters from the server's actual JSON shapes to the view models the pages use.
 * The server is the source of truth; every drift found while dogfooding is resolved here
 * (or in the server when the server was wrong), never in the pages.
 */
import type {
  AgentJob,
  ApiToken,
  ArtifactRef,
  AttemptView,
  Dataset,
  Environment,
  IntegrationView,
  McpInfo,
  Me,
  Member,
  Organization,
  PoolUser,
  ProcessView,
  Project,
  RunDetail,
  RunListItem,
  ScenarioDetail,
  ScenarioNode,
  Schedule,
  StepView,
  Trends,
  Workspace,
} from './types';

type Rec = Record<string, any>;
const arr = <T = Rec>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/** `${VAR}` / `${VAR:-default}` references anywhere in an object (vars without defaults). */
export function collectVarRefs(obj: unknown, acc = new Set<string>()): Set<string> {
  if (typeof obj === 'string') {
    for (const m of obj.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g))
      if (m[2] === undefined) acc.add(m[1]!);
  } else if (Array.isArray(obj)) obj.forEach((v) => collectVarRefs(v, acc));
  else if (obj && typeof obj === 'object')
    Object.values(obj as Rec).forEach((v) => collectVarRefs(v, acc));
  return acc;
}

export function normalizeMe(raw: Rec): Me {
  // Accept both the server shape (`orgs[]`, `workspaces[]`) and the pre-shaped maps
  // (`orgRoles`, `workspaceRoles`) used by mocks and tests.
  const orgRoles: Rec = {
    ...(raw.orgRoles && typeof raw.orgRoles === 'object' ? raw.orgRoles : {}),
  };
  const workspaceRoles: Rec = {
    ...(raw.workspaceRoles && typeof raw.workspaceRoles === 'object' ? raw.workspaceRoles : {}),
  };
  for (const o of arr(raw.orgs)) {
    if (o.organizationId) orgRoles[o.organizationId] = o.role;
    if (o.organizationSlug) orgRoles[o.organizationSlug] = o.role;
    if (o.slug) orgRoles[o.slug] = o.role;
  }
  for (const w of arr(raw.workspaces)) {
    if (w.slug) workspaceRoles[w.slug] = w.role;
    if (w.id) workspaceRoles[w.id] = w.role;
    // org membership implies a role on its workspaces; keep the org slug → role link too
    if (w.organizationSlug && orgRoles[w.organizationSlug] === undefined) {
      const viaId = arr(raw.orgs).find((o) => o.organizationId === w.organizationId);
      if (viaId) orgRoles[w.organizationSlug] = viaId.role;
    }
  }
  return {
    user: {
      id: str(raw.user?.id),
      username: str(raw.user?.username),
      email: raw.user?.email ?? undefined,
      role: raw.user?.role ?? 'viewer',
      active: raw.user?.active ?? true,
    },
    csrfToken: str(raw.csrfToken),
    scopes: arr<string>(raw.scopes) as Me['scopes'],
    orgRoles,
    workspaceRoles,
  };
}

export const normalizeOrg = (o: Rec): Organization => ({
  id: str(o.id),
  slug: str(o.slug),
  name: str(o.name, o.slug),
  description: o.description ?? undefined,
  url: o.url ?? undefined,
  myRole: o.myRole ?? o.role ?? null,
});

export const normalizeWorkspace = (w: Rec): Workspace => ({
  id: str(w.id),
  organizationId: str(w.organizationId),
  slug: str(w.slug),
  name: str(w.name, w.slug),
  description: w.description ?? undefined,
  projectCount: Number(w.projectCount ?? (Array.isArray(w.projects) ? w.projects.length : 0)),
  myRole: w.myRole ?? w.role ?? null,
});

export const normalizeMember = (m: Rec): Member => ({
  userId: str(m.userId ?? m.user_id ?? m.id),
  username: str(m.username, m.userId ?? ''),
  role: m.role,
});

/** `/api/projects` returns config objects; `/api/projects/:slug` wraps `{ config, workspace, ... }`. */
export function normalizeProject(p: Rec): Project {
  const c: Rec = p.config && typeof p.config === 'object' ? p.config : p;
  return {
    slug: str(c.slug ?? p.slug),
    name: str(c.name ?? p.name, c.slug ?? p.slug),
    description: c.description ?? undefined,
    workspace: str(p.workspace ?? c.workspace, 'default'),
    organization: str(p.organization ?? c.organization, 'default'),
    layers: arr(c.layers) as Project['layers'],
    browsers: arr(c.browsers) as Project['browsers'],
    testIdAttribute: str(c.testIdAttribute, 'data-testid'),
    envs: {
      default: str(c.envs?.default),
      available: arr<string>(c.envs?.available),
    },
    tags: {
      suites: arr<string>(c.tags?.suites),
      extra: arr<string>(c.tags?.extra),
      roles: arr<string>(c.tags?.roles),
    },
    routes: (c.routes ?? {}) as Record<string, string>,
    modules: arr(c.modules) as Project['modules'],
    processes: arr(p.processes ?? c.processes) as Project['processes'],
    screenshots: {
      policy: c.screenshots?.policy ?? { default: 'on-failure' },
      fullPage: Boolean(c.screenshots?.fullPage),
      mask: arr<string>(c.screenshots?.mask),
      viewport: c.screenshots?.viewport ?? { width: 1280, height: 720 },
      onlyOnFailure: Boolean(c.screenshots?.onlyOnFailure),
    },
    integrations: c.integrations ?? {},
    mcp: c.mcp ?? { servers: {} },
    root: p.root,
  };
}

export function normalizeEnv(e: Rec): Environment {
  const raw: Rec = e.raw ?? e;
  const refs = [...collectVarRefs(raw)];
  return {
    name: str(e.name ?? raw.name),
    description: raw.description ?? undefined,
    ui: { baseUrl: str(raw.ui?.baseUrl ?? e.ui) },
    api: {
      baseUrl: str(raw.api?.baseUrl ?? e.api),
      headers: raw.api?.headers,
      auth: raw.api?.auth,
    },
    users: raw.users,
    vars: raw.vars,
    secretNames: refs,
    secretsPresent: e.secretsPresent ?? {},
    isDefault: Boolean(e.default ?? e.isDefault),
  };
}

/** `/api/projects/:slug/datasets` → `{ file: [...], db: [...] }`. */
export function normalizeDatasets(d: Rec | Rec[]): Dataset[] {
  if (Array.isArray(d)) return d as Dataset[];
  const file = arr(d.file).map((f) => ({
    id: `file:${f.name}`,
    name: str(f.name),
    envKey: str(f.envKey, '*'),
    kind: (f.source?.type ?? f.kind ?? 'csv') as Dataset['kind'],
    storage: 'file' as const,
    sourcePath: f.source?.path ?? f.sourcePath,
    columns: arr<string>(f.columns),
    rowCount: Number(f.rowCount ?? 0),
  }));
  const db = arr(d.db).map((r) => ({
    id: str(r.id, r.name),
    name: str(r.name),
    envKey: str(r.envKey ?? r.env_key, '*'),
    kind: (r.kind ?? 'table') as Dataset['kind'],
    storage: 'db' as const,
    sourcePath: r.sourcePath ?? r.source_path ?? undefined,
    columns: arr<string>(r.columns ?? r.columns_json),
    rowCount: Number(r.rowCount ?? r.row_count ?? 0),
    updatedAt: r.updatedAt ?? r.updated_at ?? undefined,
  }));
  return [...file, ...db];
}

export function normalizePool(p: Rec | Rec[]): PoolUser[] {
  const rows = Array.isArray(p) ? p : arr(p.status ?? p.users ?? p.rows);
  return rows.map((u) => ({
    id: str(u.id ?? u.username),
    username: str(u.username, u.id),
    role: str(u.role, 'standard'),
    secretRef: str(u.secretRef ?? u.secret_ref ?? u.passwordRef),
    enabled: u.enabled ?? true,
    leased: Boolean(u.leased ?? u.leaseOwner ?? u.owner),
    leaseOwner: u.leaseOwner ?? u.owner ?? undefined,
  }));
}

export const normalizeProcess = (p: Rec): ProcessView => ({
  ...(p as ProcessView),
  source: p.source ?? 'project',
  lastStatus: p.lastStatus ?? null,
  lastRunId: p.lastRunId ?? null,
  lastRunAt: p.lastRunAt ?? null,
});

export function normalizeRunItem(r: Rec): RunListItem {
  const live: Rec | null = r.live && typeof r.live === 'object' ? r.live : null;
  return {
    id: str(r.id ?? r.runId),
    projectSlug: str(r.projectSlug ?? r.project),
    env: str(r.env ?? r.envName),
    trigger: r.trigger ?? 'cli',
    status: live?.status ?? r.status ?? 'queued',
    suiteTag: r.suiteTag ?? undefined,
    tagsExpr: r.tagsExpr ?? undefined,
    process: r.process ?? undefined,
    layers: arr(r.layers),
    browsers: arr(r.browsers),
    gitBranch: r.gitBranch ?? undefined,
    gitSha: r.gitSha ?? undefined,
    startedAt: r.startedAt ?? live?.startedAt ?? undefined,
    finishedAt: r.finishedAt ?? live?.finishedAt ?? undefined,
    durationMs: r.durationMs ?? undefined,
    totals: r.totals ?? undefined,
    startedBy: r.startedBy ?? undefined,
  };
}

export function normalizeRuns(v: Rec | Rec[]): { items: RunListItem[]; total: number } {
  const rows = Array.isArray(v) ? v : arr(v.items);
  const items = rows.map(normalizeRunItem);
  return { items, total: Array.isArray(v) ? items.length : Number(v.total ?? items.length) };
}

const jiraKeysOf = (tags: string[]) =>
  tags.filter((t) => t.startsWith('@jira:')).map((t) => t.slice('@jira:'.length));

export function normalizeScenario(s: Rec): ScenarioNode {
  const tags = arr<string>(s.tags);
  return {
    id: str(s.id),
    fingerprint: str(s.fingerprint),
    module: s.module ?? null,
    featureUri: str(s.featureUri),
    featureName: str(s.featureName, s.featureUri),
    scenarioName: str(s.scenarioName),
    exampleIndex: s.exampleIndex ?? null,
    runnerProject: str(s.runnerProject ?? s.pwProject),
    layer: s.layer ?? 'ui',
    browser: s.browser ?? undefined,
    suiteTag: s.suiteTag ?? undefined,
    tags,
    jiraKeys: arr<string>(s.jiraKeys).length ? arr<string>(s.jiraKeys) : jiraKeysOf(tags),
    status: s.status ?? 'unknown',
    attemptsCount: Number(s.attemptsCount ?? 1),
    flaky: Boolean(s.flaky),
    healed: Number(s.healed ?? s.healCount ?? 0),
    visual: Boolean(s.visual ?? tags.includes('@visual')),
    durationMs: s.durationMs ?? undefined,
    errorMessage: s.errorMessage ?? undefined,
  };
}

export function normalizeRunDetail(d: Rec): RunDetail {
  const run: Rec = d.run ?? d;
  const item = normalizeRunItem({ ...run, live: d.live ?? run.live });
  const summary: Rec | null = d.summary ?? null;
  return {
    ...item,
    totals: item.totals ?? summary?.totals ?? undefined,
    gates: run.gates ?? run.totals?.gates ?? summary?.gates ?? undefined,
    command: d.manifest?.command ?? run.command,
    artifactsDir: run.artifactsDir ?? d.manifest?.artifactsDir,
    exitCode: d.live?.exitCode ?? run.exitCode,
    errorText: run.errorText ?? undefined,
    ciUrl: run.ciUrl ?? d.manifest?.ci?.url,
    reportPaths: {
      html: d.reportUrl ?? d.reportPaths?.html ?? undefined,
      dashboard: d.dashboardUrl ?? d.reportPaths?.dashboard ?? undefined,
      junit: d.reportPaths?.junit,
      messages: d.reportPaths?.messages,
    },
    scenarios: arr(d.scenarios).map(normalizeScenario),
  };
}

const artifactRef = (a: Rec | null | undefined): ArtifactRef | undefined =>
  a && a.id
    ? {
        id: str(a.id),
        url: a.url ?? `/api/artifacts/${a.id}`,
        kind: str(a.kind),
        phase: a.phase ?? null,
        stepIndex: a.stepIndex ?? null,
        fileName: str(a.fileName ?? a.relPath),
        width: a.width ?? null,
        height: a.height ?? null,
        mediaType: str(a.mediaType, 'image/png'),
      }
    : undefined;

export function normalizeScenarioDetail(d: Rec): ScenarioDetail {
  const node = normalizeScenario(d);
  const attempts: AttemptView[] = arr(d.attempts).map((a) => {
    const artifacts = arr(a.artifacts);
    const scenarioShots = arr(a.scenarioShots).length
      ? arr(a.scenarioShots)
      : artifacts.filter((x) => x.kind === 'screenshot' && x.stepIndex == null);
    const heals = arr(a.heals);
    const byPhase = (phase: string) => artifactRef(scenarioShots.find((x) => x.phase === phase));
    const steps: StepView[] = arr(a.steps).map((s) => {
      let visuals = artifacts.filter((x) => x.kind === 'visual' && x.stepIndex === s.stepIndex);
      // A failed check's expected/actual/diff images are ingested without a step index; pair
      // them with the step that names the baseline.
      const named = /visual baseline "([^"]+)"/.exec(str(s.text))?.[1]?.replace(/\.png$/, '');
      if (!visuals.length && named)
        visuals = artifacts.filter(
          (x) =>
            x.kind === 'visual' &&
            x.stepIndex == null &&
            str(x.fileName).split('/').pop()!.startsWith(`${named}-`),
        );
      const vis = visuals.length
        ? {
            name:
              named ??
              str(visuals[0]?.fileName)
                .split('/')
                .pop()!
                .replace(/-(expected|actual|diff)\.png$/, ''),
            expected: artifactRef(visuals.find((x) => x.phase === 'expected')),
            actual: artifactRef(visuals.find((x) => x.phase === 'actual')),
            diff: artifactRef(visuals.find((x) => x.phase === 'diff')),
          }
        : undefined;
      return {
        id: str(s.id),
        stepIndex: Number(s.stepIndex ?? -1),
        kind: s.kind ?? 'step',
        hookType: s.hookType ?? undefined,
        keyword: s.keyword ?? undefined,
        text: str(s.text),
        argument: s.argument,
        status: s.status ?? 'unknown',
        durationMs: s.durationMs ?? undefined,
        errorMessage: s.errorMessage ?? undefined,
        errorStack: s.errorStack ?? undefined,
        definitionLocation: s.definitionLocation ?? undefined,
        layerHint: s.layerHint ?? undefined,
        apiSnapshot: s.apiSnapshot ?? undefined,
        before: artifactRef(s.before),
        after: artifactRef(s.after),
        visual: vis,
        heals: heals.filter((h) => h.stepIndex === s.stepIndex) as StepView['heals'],
      };
    });
    return {
      id: str(a.id),
      attempt: Number(a.attempt ?? 0),
      status: a.status ?? 'unknown',
      durationMs: a.durationMs ?? undefined,
      errorMessage: a.errorMessage ?? undefined,
      steps,
      scenarioStart: byPhase('scenario-start'),
      scenarioEnd: byPhase('scenario-end'),
      failure: byPhase('failure'),
      trace: artifactRef(artifacts.find((x) => x.kind === 'trace')),
      video: artifactRef(artifacts.find((x) => x.kind === 'video')),
    };
  });
  return { ...node, attempts, issueLinks: arr(d.issueLinks) };
}

/** `/api/projects/:slug/integrations` → `{ github, jira, mcp: {name: cfg}, rows }`. */
export function normalizeIntegrations(v: Rec | Rec[]): IntegrationView[] {
  if (Array.isArray(v)) return v as IntegrationView[];
  const out: IntegrationView[] = [];
  if (v.github)
    out.push({
      provider: 'github',
      enabled: Boolean(v.github.enabled),
      config: v.github,
      secretEnv: { token: str(v.github.tokenEnv, 'GITHUB_TOKEN') },
      secretsPresent: { token: Boolean(v.github.tokenPresent) },
      lastSyncAt: v.github.lastSyncAt ?? null,
    });
  if (v.jira)
    out.push({
      provider: 'jira',
      enabled: Boolean(v.jira.enabled),
      config: v.jira,
      secretEnv: {
        email: str(v.jira.emailEnv, 'JIRA_EMAIL'),
        token: str(v.jira.tokenEnv, 'JIRA_API_TOKEN'),
      },
      secretsPresent: {
        email: Boolean(v.jira.emailPresent),
        token: Boolean(v.jira.tokenPresent),
      },
      lastSyncAt: v.jira.lastSyncAt ?? null,
    });
  for (const [name, cfg] of Object.entries((v.mcp ?? {}) as Rec)) {
    const c = cfg as Rec;
    const envNames: Record<string, string> = { ...(c.envFrom ?? {}), ...(c.headersFrom ?? {}) };
    out.push({
      provider: `mcp:${name}`,
      enabled: c.enabled ?? true,
      config: c,
      secretEnv: envNames,
      secretsPresent: c.secretsPresent ?? {},
      lastSyncAt: null,
    });
  }
  return out;
}

export function normalizeSchedule(s: Rec): Schedule {
  const input: Rec = s.runInput ?? {};
  return {
    id: str(s.id),
    projectSlug: str(s.projectSlug ?? s.project),
    name: str(s.name),
    cron: str(s.cron ?? s.cronExpr),
    timezone: str(s.timezone, 'UTC'),
    env: s.env ?? input.env ?? undefined,
    tags: s.tags ?? input.tags ?? undefined,
    layers: s.layers ?? input.layers ?? undefined,
    browsers: s.browsers ?? input.browsers ?? undefined,
    workers: s.workers ?? input.workers ?? undefined,
    harMode: s.harMode ?? input.harMode ?? undefined,
    overlap: s.overlap ?? s.overlapPolicy ?? 'skip',
    jitterSeconds: Number(s.jitterSeconds ?? 0),
    catchUp: Boolean(s.catchUp),
    enabled: s.enabled ?? true,
    notify: arr(s.notify),
    nextRunAt: s.nextRunAt ?? arr<string>(s.nextFireTimes)[0] ?? null,
    lastRunId: s.lastRunId ?? null,
    lastStatus: s.lastStatus ?? null,
    source: s.source ?? 'db',
  };
}

export const normalizeToken = (t: Rec): ApiToken => ({
  id: str(t.id),
  name: str(t.name),
  prefix: str(t.prefix ?? t.tokenPrefix),
  scopes: arr(t.scopes ?? t.scopesJson) as ApiToken['scopes'],
  expiresAt: t.expiresAt ?? null,
  lastUsedAt: t.lastUsedAt ?? null,
  revokedAt: t.revokedAt ?? null,
  createdAt: str(t.createdAt),
  owner: t.owner ?? t.username ?? undefined,
});

export const normalizeMcpInfo = (i: Rec): McpInfo => ({
  url: str(i.url),
  transport: 'streamable-http',
  version: str(i.version),
  tools: arr(i.tools).map((t) => ({
    name: str(t.name),
    scope: str(t.scope),
    description: str(t.description ?? t.title),
  })),
});

export const normalizeAgentJob = (j: Rec): AgentJob => ({
  id: str(j.id),
  projectSlug: str(j.projectSlug ?? j.project),
  kind: j.kind ?? j.role ?? 'plan',
  goal: j.goal ?? undefined,
  status: j.status ?? 'queued',
  provider: j.provider ?? undefined,
  model: j.model ?? undefined,
  costUsd: j.costUsd ?? undefined,
  turns: j.turns ?? undefined,
  proposalId: j.proposalId ?? undefined,
  diffText: j.diffText ?? undefined,
  summary: j.summary ?? undefined,
  startedAt: j.startedAt ?? undefined,
  finishedAt: j.finishedAt ?? undefined,
});

/** Trends come from three endpoints; the dashboard wants one object. */
export function normalizeTrends(
  trends: Rec | Rec[],
  flaky?: Rec | Rec[],
  heal?: Rec | Rec[],
  health?: Rec | Rec[],
): Trends {
  const runs = (Array.isArray(trends) ? trends : arr(trends.runs)).map((r) => ({
    runId: str(r.runId ?? r.id),
    startedAt: str(r.startedAt),
    passRate: Number(r.passRate ?? 0),
    durationMs: Number(r.durationMs ?? 0),
    flakyRate: r.total ? Number(r.flaky ?? 0) / Number(r.total) : Number(r.flakyRate ?? 0),
    process: r.process ?? undefined,
    env: str(r.env),
  }));
  const flakyRows = (Array.isArray(flaky) ? flaky : arr(flaky?.flaky ?? (trends as Rec).flaky)).map(
    (f) => ({
      fingerprint: str(f.fingerprint),
      scenarioName: str(f.scenarioName),
      featureUri: str(f.featureUri),
      runnerProject: str(f.runnerProject ?? f.pwProject),
      flakyRate: Number(f.flakyRate ?? 0),
      runsCount: Number(f.runsCount ?? 0),
      quarantined: Boolean(f.quarantined),
    }),
  );
  const healSrc = Array.isArray(heal) ? heal : arr(heal?.locators ?? (trends as Rec).locators);
  const locators = healSrc.map((l) => ({
    selector: str(l.selector),
    pageHint: l.pageHint ?? undefined,
    failCount: Number(l.failCount ?? 0),
    healCount: Number(l.healCount ?? 0),
    lastStrategy: l.lastStrategy ?? undefined,
    suggestedSelector: l.suggestedSelector ?? undefined,
  }));
  const healthRows = (
    Array.isArray(health) ? health : arr(health?.health ?? (trends as Rec).health)
  ).map((h) => ({
    process: str(h.process, 'all'),
    score: Number(h.score ?? h.suiteHealth ?? 0),
    passRate: Number(h.passRate ?? 0),
    flaky: Number(h.flaky ?? 0),
    fragility: Number(h.fragility ?? 0),
  }));
  return { runs, flaky: flakyRows, locators, health: healthRows };
}
