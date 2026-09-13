import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type {
  AgentJob,
  ApiToken,
  CompareResult,
  CreateProjectInput,
  Dataset,
  Environment,
  FeatureFile,
  Health,
  ImportPreview,
  ImportProjectInput,
  IntegrationView,
  McpInfo,
  Member,
  Organization,
  PoolUser,
  ProcessView,
  Project,
  Proposal,
  RunDetail,
  RunListItem,
  ScenarioDetail,
  Schedule,
  ScheduleRun,
  StartRunInput,
  StepDef,
  Trends,
  UserRow,
  Workspace,
  Diagnostic,
} from './types';
import {
  normalizeAgentJob,
  normalizeDatasets,
  normalizeEnv,
  normalizeIntegrations,
  normalizeMcpInfo,
  normalizeMember,
  normalizeOrg,
  normalizePool,
  normalizeProcess,
  normalizeProject,
  normalizeRunDetail,
  normalizeRuns,
  normalizeScenarioDetail,
  normalizeSchedule,
  normalizeToken,
  normalizeTrends,
  normalizeWorkspace,
} from './normalize';

type Rec = Record<string, unknown>;
const list = (v: unknown): Rec[] => (Array.isArray(v) ? (v as Rec[]) : []);

export const keys = {
  orgs: ['orgs'] as const,
  workspaces: (org?: string) => ['workspaces', org] as const,
  projects: (ws?: string) => ['projects', ws] as const,
  project: (slug: string) => ['project', slug] as const,
  envs: (slug: string) => ['envs', slug] as const,
  datasets: (slug: string) => ['datasets', slug] as const,
  pool: (slug: string) => ['pool', slug] as const,
  processes: (slug: string) => ['processes', slug] as const,
  runs: (f: Record<string, unknown>) => ['runs', f] as const,
  run: (id: string) => ['run', id] as const,
  scenario: (runId: string, sid: string) => ['scenario', runId, sid] as const,
  features: (slug: string) => ['features', slug] as const,
  feature: (slug: string, path: string) => ['feature', slug, path] as const,
  steps: (slug: string) => ['steps', slug] as const,
  agentJobs: (slug?: string) => ['agentJobs', slug] as const,
  proposals: (slug?: string) => ['proposals', slug] as const,
  integrations: (slug: string) => ['integrations', slug] as const,
  schedules: (slug?: string) => ['schedules', slug] as const,
  users: ['users'] as const,
  tokens: ['tokens'] as const,
  mcpInfo: ['mcpInfo'] as const,
  health: ['health'] as const,
  trends: (f: Record<string, unknown>) => ['trends', f] as const,
};

export const useOrgs = () =>
  useQuery({
    queryKey: keys.orgs,
    queryFn: async () => list(await api<unknown>('/api/orgs')).map(normalizeOrg) as Organization[],
  });
export const useWorkspaces = (org?: string) =>
  useQuery({
    queryKey: keys.workspaces(org),
    queryFn: async () =>
      list(await api<unknown>(`/api/workspaces${qs({ org })}`)).map(
        normalizeWorkspace,
      ) as Workspace[],
  });
/** Member routes are addressed by workspace/org id or slug (the server accepts both). */
export const useWorkspaceMembers = (ws: string) =>
  useQuery({
    queryKey: ['wsMembers', ws],
    queryFn: async () =>
      list(await api<unknown>(`/api/workspaces/${ws}/members`)).map(normalizeMember) as Member[],
    enabled: Boolean(ws),
  });
export const useOrgMembers = (org: string) =>
  useQuery({
    queryKey: ['orgMembers', org],
    queryFn: async () =>
      list(await api<unknown>(`/api/orgs/${org}/members`)).map(normalizeMember) as Member[],
    enabled: Boolean(org),
  });
export const useProjects = (ws?: string) =>
  useQuery({
    queryKey: keys.projects(ws),
    queryFn: async () => {
      const rows = list(await api<unknown>(`/api/projects${qs({ workspace: ws })}`)).map(
        normalizeProject,
      ) as Project[];
      return ws ? rows.filter((p) => p.workspace === ws) : rows;
    },
  });
export const useProject = (slug: string) =>
  useQuery({
    queryKey: keys.project(slug),
    queryFn: async () => normalizeProject(await api<Rec>(`/api/projects/${slug}`)),
    enabled: Boolean(slug),
  });
export const useEnvs = (slug: string) =>
  useQuery({
    queryKey: keys.envs(slug),
    queryFn: async () =>
      list(await api<unknown>(`/api/projects/${slug}/envs`)).map(normalizeEnv) as Environment[],
    enabled: Boolean(slug),
  });
export const useDatasets = (slug: string) =>
  useQuery({
    queryKey: keys.datasets(slug),
    queryFn: async () =>
      normalizeDatasets(await api<Rec | Rec[]>(`/api/projects/${slug}/datasets`)) as Dataset[],
    enabled: Boolean(slug),
  });
export const usePool = (slug: string) =>
  useQuery({
    queryKey: keys.pool(slug),
    queryFn: async () =>
      normalizePool(await api<Rec | Rec[]>(`/api/projects/${slug}/users-pool`)) as PoolUser[],
    enabled: Boolean(slug),
  });
export const useProcesses = (slug: string) =>
  useQuery({
    queryKey: keys.processes(slug),
    queryFn: async () =>
      list(await api<unknown>(`/api/projects/${slug}/processes`)).map(
        normalizeProcess,
      ) as ProcessView[],
    enabled: Boolean(slug),
  });
export const useRuns = (filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: keys.runs(filters),
    queryFn: async () =>
      normalizeRuns(await api<Rec | Rec[]>(`/api/runs${qs(filters)}`)) as {
        items: RunListItem[];
        total: number;
      },
    refetchInterval: 5000,
  });
export const useRun = (id: string, live = false) =>
  useQuery({
    queryKey: keys.run(id),
    queryFn: async () => normalizeRunDetail(await api<Rec>(`/api/runs/${id}`)) as RunDetail,
    enabled: Boolean(id),
    refetchInterval: live ? 3000 : false,
  });
export const useScenario = (runId: string, sid: string) =>
  useQuery({
    queryKey: keys.scenario(runId, sid),
    queryFn: async () =>
      normalizeScenarioDetail(
        await api<Rec>(`/api/runs/${runId}/scenarios/${sid}`),
      ) as ScenarioDetail,
    enabled: Boolean(runId && sid),
  });
export const useCompare = (before?: string, after?: string, enabled = true) =>
  useQuery({
    queryKey: ['compare', before, after],
    queryFn: () => api<CompareResult>(`/api/artifacts/compare${qs({ before, after })}`),
    enabled: enabled && Boolean(before && after),
  });
export const useFeatures = (slug: string) =>
  useQuery({
    queryKey: keys.features(slug),
    queryFn: () => api<FeatureFile[]>(`/api/projects/${slug}/features`),
    enabled: Boolean(slug),
  });
export const useFeature = (slug: string, path: string) =>
  useQuery({
    queryKey: keys.feature(slug, path),
    queryFn: () => api<{ path: string; content: string }>(`/api/projects/${slug}/features/${path}`),
    enabled: Boolean(slug && path),
  });
export const useSteps = (slug: string) =>
  useQuery({
    queryKey: keys.steps(slug),
    queryFn: () => api<StepDef[]>(`/api/projects/${slug}/steps`),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
export const useAgentJobs = (slug?: string) =>
  useQuery({
    queryKey: keys.agentJobs(slug),
    queryFn: async () =>
      list(await api<unknown>(`/api/agents/jobs${qs({ project: slug })}`)).map(
        normalizeAgentJob,
      ) as AgentJob[],
    refetchInterval: 5000,
  });
export const useProposals = (slug?: string) =>
  useQuery({
    queryKey: keys.proposals(slug),
    queryFn: async () =>
      list(await api<unknown>(`/api/proposals${qs({ project: slug })}`)) as unknown as Proposal[],
  });
export const useIntegrations = (slug: string) =>
  useQuery({
    queryKey: keys.integrations(slug),
    queryFn: async () =>
      normalizeIntegrations(
        await api<Rec | Rec[]>(`/api/projects/${slug}/integrations`),
      ) as IntegrationView[],
    enabled: Boolean(slug),
  });
export const useSchedules = (slug?: string) =>
  useQuery({
    queryKey: keys.schedules(slug),
    queryFn: async () =>
      list(await api<unknown>(`/api/schedules${qs({ project: slug })}`)).map(
        normalizeSchedule,
      ) as Schedule[],
  });
export const useScheduleHistory = (id: string) =>
  useQuery({
    queryKey: ['scheduleHistory', id],
    queryFn: async () =>
      list(await api<unknown>(`/api/schedules/${id}/history`)) as unknown as ScheduleRun[],
    enabled: Boolean(id),
  });
export const useUsers = () =>
  useQuery({
    queryKey: keys.users,
    queryFn: async () => list(await api<unknown>('/api/users')) as unknown as UserRow[],
  });
export const useTokens = (all = false) =>
  useQuery({
    queryKey: [...keys.tokens, all],
    queryFn: async () =>
      list(await api<unknown>(`/api/tokens${qs({ all: all ? 1 : undefined })}`)).map(
        normalizeToken,
      ) as ApiToken[],
  });
export const useMcpInfo = () =>
  useQuery({
    queryKey: keys.mcpInfo,
    queryFn: async () => normalizeMcpInfo(await api<Rec>('/api/mcp/info')) as McpInfo,
  });
/** Dashboard trends: merge trends + flaky + heal (+ insights when a project is selected). */
export const useTrends = (f: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: keys.trends(f),
    queryFn: async () => {
      const project = f.project ? String(f.project) : undefined;
      const [trends, flaky, heal, insights] = await Promise.all([
        api<Rec | Rec[]>(`/api/stats/trends${qs(f)}`),
        project ? api<Rec | Rec[]>(`/api/stats/flaky${qs({ project })}`).catch(() => []) : [],
        project ? api<Rec | Rec[]>(`/api/stats/heal${qs({ project })}`).catch(() => ({})) : {},
        project ? api<Rec | Rec[]>(`/api/stats/insights${qs({ project })}`).catch(() => ({})) : {},
      ]);
      return normalizeTrends(trends, flaky, heal, insights) as Trends;
    },
  });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: readonly unknown[][]) =>
    prefixes.forEach((p) => qc.invalidateQueries({ queryKey: p }));
}

export const useStartRun = () => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: StartRunInput) => api<{ runId: string }>('/api/runs', { json: input }),
    onSuccess: () => inv(['runs']),
  });
};
export const useCancelRun = () => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api(`/api/runs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => inv(['runs'], ['run']),
  });
};

/** Includes the capabilities of the CLI the server spawns, which gates import and delete. */
export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: () => api<Health>('/api/health'),
    staleTime: 60_000,
  });

export const useCreateProject = () => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api<Project>('/api/projects', { json: input }),
    // `['project', slug]` too: the slug may have been deleted and re-created, and a stale entry
    // from before the delete would render on the settings page this navigates to.
    onSuccess: (_p, input) => inv(['projects'], [...keys.project(input.slug)]),
  });
};

export const useDeleteProject = () => {
  const inv = useInvalidate();
  return useMutation({
    // The confirmation is sent as well as typed: the server refuses a delete whose ?confirm does
    // not equal the slug, so a mis-wired client cannot remove the wrong project.
    mutationFn: (slug: string) =>
      api<{ ok: true; slug: string; trashedTo: string | null; schedulesRemoved: number }>(
        `/api/projects/${slug}?confirm=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      ),
    // Deliberately leaves the deleted project's own `['project', slug]` entry alone. The settings
    // page is still mounted for the moment it takes to navigate away, so both invalidating and
    // removing that key make it refetch a slug that no longer exists and log a 404. The stale
    // entry harms nothing -- nothing renders it again, and re-creating the slug refetches it.
    onSuccess: () => inv(['projects'], ['schedules']),
  });
};

/** A zip goes up as multipart; a path or git URL as JSON. Same route either way. */
function importRequest(input: ImportProjectInput) {
  if (input.kind === 'zip') {
    if (!input.file) throw new Error('Choose a .zip file to upload.');
    const form = new FormData();
    if (input.slug) form.set('slug', input.slug);
    if (input.workspace) form.set('workspace', input.workspace);
    if (input.force) form.set('force', 'true');
    if (input.dryRun) form.set('dryRun', 'true');
    // The file part goes last: @fastify/multipart streams fields in order, and req.file() stops
    // at the first file, so anything after it would not be read.
    form.set('file', input.file);
    return { form };
  }
  return {
    json: {
      kind: input.kind,
      source: input.source ?? '',
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.force ? { force: true } : {}),
      ...(input.dryRun ? { dryRun: true } : {}),
    },
  };
}

export const useImportProject = () => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: ImportProjectInput) =>
      api<Project>('/api/projects/import', importRequest(input)),
    onSuccess: (project) => inv(['projects'], [...keys.project(project.slug)]),
  });
};

/** Same route with dryRun, so the dialog can report what it found without writing. */
export const useImportPreview = () =>
  useMutation({
    mutationFn: (input: ImportProjectInput) =>
      api<ImportPreview>('/api/projects/import', importRequest({ ...input, dryRun: true })),
  });
/** The server answers `{ errors, warnings }` (LintResult); the editor works with flat diagnostics. */
export function toDiagnostics(r: Rec | null | undefined): Diagnostic[] {
  if (!r) return [];
  if (Array.isArray(r.diagnostics)) return r.diagnostics as Diagnostic[];
  const mk = (severity: Diagnostic['severity']) => (d: Rec) => ({
    severity,
    rule: String(d.rule ?? 'lint'),
    message: String(d.message ?? ''),
    line: typeof d.line === 'number' ? d.line : undefined,
    column: typeof d.column === 'number' ? d.column : undefined,
    fix: d.fix as Diagnostic['fix'],
  });
  return [...list(r.errors).map(mk('error')), ...list(r.warnings).map(mk('warning'))];
}

export const useValidateFeature = (slug: string) =>
  useMutation({
    mutationFn: async (input: { path: string; content: string }) => ({
      diagnostics: toDiagnostics(
        await api<Rec>(`/api/projects/${slug}/features/validate`, { json: input }),
      ),
    }),
  });
export const useSaveFeature = (slug: string) => {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (input: { path: string; content: string }) =>
      api<{ ok: true }>(`/api/projects/${slug}/features/${input.path}`, {
        method: 'PUT',
        json: { content: input.content },
      }),
    onSuccess: () => inv(['features', slug], ['feature', slug]),
  });
};
