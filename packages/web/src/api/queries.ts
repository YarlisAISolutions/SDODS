import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './client';
import type {
  AgentJob,
  ApiToken,
  CompareResult,
  Dataset,
  Environment,
  FeatureFile,
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
  trends: (f: Record<string, unknown>) => ['trends', f] as const,
};

export const useOrgs = () =>
  useQuery({ queryKey: keys.orgs, queryFn: () => api<Organization[]>('/api/orgs') });
export const useWorkspaces = (org?: string) =>
  useQuery({
    queryKey: keys.workspaces(org),
    queryFn: () => api<Workspace[]>(`/api/workspaces${qs({ org })}`),
  });
export const useWorkspaceMembers = (ws: string) =>
  useQuery({
    queryKey: ['wsMembers', ws],
    queryFn: () => api<Member[]>(`/api/workspaces/${ws}/members`),
    enabled: Boolean(ws),
  });
export const useOrgMembers = (org: string) =>
  useQuery({
    queryKey: ['orgMembers', org],
    queryFn: () => api<Member[]>(`/api/orgs/${org}/members`),
    enabled: Boolean(org),
  });
export const useProjects = (ws?: string) =>
  useQuery({
    queryKey: keys.projects(ws),
    queryFn: () => api<Project[]>(`/api/projects${qs({ workspace: ws })}`),
  });
export const useProject = (slug: string) =>
  useQuery({
    queryKey: keys.project(slug),
    queryFn: () => api<Project>(`/api/projects/${slug}`),
    enabled: Boolean(slug),
  });
export const useEnvs = (slug: string) =>
  useQuery({
    queryKey: keys.envs(slug),
    queryFn: () => api<Environment[]>(`/api/projects/${slug}/envs`),
    enabled: Boolean(slug),
  });
export const useDatasets = (slug: string) =>
  useQuery({
    queryKey: keys.datasets(slug),
    queryFn: () => api<Dataset[]>(`/api/projects/${slug}/datasets`),
    enabled: Boolean(slug),
  });
export const usePool = (slug: string) =>
  useQuery({
    queryKey: keys.pool(slug),
    queryFn: () => api<PoolUser[]>(`/api/projects/${slug}/users-pool`),
    enabled: Boolean(slug),
  });
export const useProcesses = (slug: string) =>
  useQuery({
    queryKey: keys.processes(slug),
    queryFn: () => api<ProcessView[]>(`/api/projects/${slug}/processes`),
    enabled: Boolean(slug),
  });
export const useRuns = (filters: Record<string, string | undefined>) =>
  useQuery({
    queryKey: keys.runs(filters),
    queryFn: () => api<{ items: RunListItem[]; total: number }>(`/api/runs${qs(filters)}`),
    refetchInterval: 5000,
  });
export const useRun = (id: string, live = false) =>
  useQuery({
    queryKey: keys.run(id),
    queryFn: () => api<RunDetail>(`/api/runs/${id}`),
    enabled: Boolean(id),
    refetchInterval: live ? 3000 : false,
  });
export const useScenario = (runId: string, sid: string) =>
  useQuery({
    queryKey: keys.scenario(runId, sid),
    queryFn: () => api<ScenarioDetail>(`/api/runs/${runId}/scenarios/${sid}`),
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
    queryFn: () => api<AgentJob[]>(`/api/agents/jobs${qs({ project: slug })}`),
    refetchInterval: 5000,
  });
export const useProposals = (slug?: string) =>
  useQuery({
    queryKey: keys.proposals(slug),
    queryFn: () => api<Proposal[]>(`/api/proposals${qs({ project: slug })}`),
  });
export const useIntegrations = (slug: string) =>
  useQuery({
    queryKey: keys.integrations(slug),
    queryFn: () => api<IntegrationView[]>(`/api/projects/${slug}/integrations`),
    enabled: Boolean(slug),
  });
export const useSchedules = (slug?: string) =>
  useQuery({
    queryKey: keys.schedules(slug),
    queryFn: () => api<Schedule[]>(`/api/schedules${qs({ project: slug })}`),
  });
export const useScheduleHistory = (id: string) =>
  useQuery({
    queryKey: ['scheduleHistory', id],
    queryFn: () => api<ScheduleRun[]>(`/api/schedules/${id}/history`),
    enabled: Boolean(id),
  });
export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => api<UserRow[]>('/api/users') });
export const useTokens = (all = false) =>
  useQuery({
    queryKey: [...keys.tokens, all],
    queryFn: () => api<ApiToken[]>(`/api/tokens${qs({ all: all ? 1 : undefined })}`),
  });
export const useMcpInfo = () =>
  useQuery({ queryKey: keys.mcpInfo, queryFn: () => api<McpInfo>('/api/mcp/info') });
export const useTrends = (f: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: keys.trends(f), queryFn: () => api<Trends>(`/api/stats/trends${qs(f)}`) });

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
export const useValidateFeature = (slug: string) =>
  useMutation({
    mutationFn: (input: { path: string; content: string }) =>
      api<{ diagnostics: Diagnostic[] }>(`/api/projects/${slug}/features/validate`, {
        json: input,
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
