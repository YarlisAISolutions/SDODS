import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAgentJobs, useInvalidate, useProjects, useProposals } from '../api/queries';
import { useSse } from '../api/sse';
import type { AgentJob, Proposal } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  StatusPill,
  Textarea,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { fmtRelative } from '../lib/utils';
import { DiffView } from './run/DiffView';

const KINDS = [
  {
    value: 'plan',
    label: 'Plan',
    help: 'Explore the app or its source and write a tagged test plan.',
  },
  {
    value: 'generate',
    label: 'Generate',
    help: 'Turn a plan, a goal or a recording into a feature, steps and a page object.',
  },
  {
    value: 'heal',
    label: 'Heal',
    help: 'Fix a failing scenario: locator or step patch, re-run, propose.',
  },
  {
    value: 'upgrade',
    label: 'Upgrade',
    help: 'Propose scenarios for a code diff or OpenAPI change.',
  },
  {
    value: 'review',
    label: 'Review',
    help: 'Lint tags and suggest data-driven refactors (no agent loop).',
  },
];

export function AgentsPage() {
  const [params] = useSearchParams();
  const { workspace } = useWorkspace();
  const projects = useProjects(workspace?.slug);
  const jobs = useAgentJobs();
  const proposals = useProposals();
  const { hasScope, isAdmin } = useAuth();
  const canRun = isAdmin || hasScope('agents:run');
  const canReview = isAdmin || hasScope('agents:review');
  const inv = useInvalidate();
  const { toast } = useToast();
  const [form, setForm] = useState({
    project: params.get('project') ?? '',
    kind: params.get('kind') ?? 'generate',
    goal: params.get('scenario') ? `Heal scenario ${params.get('scenario')}` : '',
    budgetUsd: 2,
    dryRun: false,
    adapter: 'claude',
  });
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [stream, setStream] = useState<Array<{ kind: string; text: string }>>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const start = useMutation({
    mutationFn: () =>
      api<AgentJob>('/api/agents/jobs', {
        json: { ...form, project: form.project || projects.data?.[0]?.slug },
      }),
    onSuccess: (j) => {
      setActiveJob(j.id);
      setStream([]);
      inv(['agentJobs']);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  useSse<any>(activeJob ? `/api/agents/jobs/${activeJob}/events` : null, {
    onMessage: (m) => {
      if (m.event === 'text') setStream((s) => [...s, { kind: 'text', text: m.data.text }]);
      else if (m.event === 'tool')
        setStream((s) => [
          ...s,
          { kind: 'tool', text: `${m.data.name}(${JSON.stringify(m.data.input)})` },
        ]);
      else if (m.event === 'diff')
        setStream((s) => [...s, { kind: 'diff', text: m.data.diffText }]);
      else if (m.event === 'done') {
        setStream((s) => [
          ...s,
          {
            kind: 'done',
            text: `finished: ${m.data.status}${m.data.costUsd != null ? ` · $${m.data.costUsd}` : ''}`,
          },
        ]);
        inv(['agentJobs'], ['proposals']);
      }
    },
  });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      api(`/api/proposals/${id}/${action}`, {
        method: 'POST',
        json: action === 'accept' ? { branch: `automax/${id}` } : {},
      }),
    onSuccess: (_r, v) => {
      inv(['proposals'], ['agentJobs']);
      setSelectedProposal(null);
      toast(
        v.action === 'accept' ? 'Proposal applied on a branch' : 'Proposal rejected',
        'success',
      );
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const kindHelp = KINDS.find((k) => k.value === form.kind)?.help;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Agents"
        subtitle="Provider-agnostic roles that read, run and drive a browser through MCP, but only write proposals you review. LLM keys are yours; AutoMax tokens are free."
      />
      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card title="New job">
          <div className="space-y-3">
            <Field label="Project">
              <Select
                value={form.project || projects.data?.[0]?.slug || ''}
                onChange={(e) => setForm({ ...form, project: e.target.value })}
              >
                {(projects.data ?? []).map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" hint={kindHelp}>
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Goal / input"
              hint="a goal, a plan path, a scenario fingerprint, or a diff range like main..feature/x"
            >
              <Textarea
                rows={3}
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Budget (USD)">
                <Input
                  type="number"
                  step="0.5"
                  value={form.budgetUsd}
                  onChange={(e) => setForm({ ...form, budgetUsd: Number(e.target.value) })}
                />
              </Field>
              <Field label="Adapter">
                <Select
                  value={form.adapter}
                  onChange={(e) => setForm({ ...form, adapter: e.target.value })}
                >
                  <option value="claude">claude</option>
                  <option value="openai">openai-compatible</option>
                  <option value="fake">fake (no LLM)</option>
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.dryRun}
                onChange={(e) => setForm({ ...form, dryRun: e.target.checked })}
              />{' '}
              dry run (print prompt, tools and budget only)
            </label>
            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={!canRun || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? 'Starting…' : 'Start'}
            </Button>
            {!canRun && (
              <div className="muted text-[11px]">
                Your role cannot run agents (needs agents:run).
              </div>
            )}
          </div>
        </Card>
        <div className="space-y-3">
          <Card title="Live output">
            <div className="mono max-h-64 space-y-1 overflow-auto text-[12px]">
              {stream.length === 0 && (
                <div className="muted">
                  Start a job to stream its reasoning, tool calls and diff here.
                </div>
              )}
              {stream.map((s, i) =>
                s.kind === 'diff' ? (
                  <DiffView key={i} text={s.text} />
                ) : (
                  <div
                    key={i}
                    className={
                      s.kind === 'tool'
                        ? 'text-brand-600'
                        : s.kind === 'done'
                          ? 'status-passed'
                          : ''
                    }
                  >
                    {s.kind === 'tool' ? '⚙ ' : ''}
                    {s.text}
                  </div>
                ),
              )}
            </div>
          </Card>
          <Card title="Jobs">
            <ul className="divide-y divide-[var(--border)] text-sm">
              {(jobs.data ?? []).map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <StatusPill status={j.status} />
                  <Badge tone="purple">{j.kind}</Badge>
                  <span className="mono">{j.projectSlug}</span>
                  <span className="min-w-0 flex-1 truncate">{j.goal ?? j.summary}</span>
                  <span className="muted text-xs">
                    {j.model ?? j.provider} {j.costUsd != null ? `· $${j.costUsd.toFixed(2)}` : ''}{' '}
                    · {fmtRelative(j.finishedAt ?? j.startedAt)}
                  </span>
                  {j.proposalId && (
                    <Button
                      size="sm"
                      onClick={() =>
                        setSelectedProposal(
                          (proposals.data ?? []).find((p) => p.id === j.proposalId) ?? null,
                        )
                      }
                    >
                      Review
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <Card title="Proposals">
        <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="divide-y divide-[var(--border)] text-sm">
            {(proposals.data ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProposal(p)}
                  className={`w-full py-1.5 text-left hover:underline ${selectedProposal?.id === p.id ? 'font-medium' : ''}`}
                >
                  <StatusPill status={p.status === 'pending' ? 'queued' : p.status} />{' '}
                  <Badge tone="purple">{p.role}</Badge> {p.summary}
                </button>
              </li>
            ))}
          </ul>
          <div>
            {selectedProposal ? (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="mono">{selectedProposal.id}</span>
                  {selectedProposal.files.map((f) => (
                    <Badge
                      key={f.path}
                      tone={f.op === 'add' ? 'green' : f.op === 'delete' ? 'red' : 'blue'}
                      className="mono"
                    >
                      {f.op} {f.path}
                    </Badge>
                  ))}
                  {selectedProposal.status === 'pending' && canReview && (
                    <span className="ml-auto flex gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => decide.mutate({ id: selectedProposal.id, action: 'reject' })}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => decide.mutate({ id: selectedProposal.id, action: 'accept' })}
                      >
                        Accept on branch
                      </Button>
                    </span>
                  )}
                </div>
                <DiffView text={selectedProposal.diffText} />
              </>
            ) : (
              <div className="muted text-xs">
                Select a proposal to see its diff. Accepting applies the files on a git branch and
                runs lint.
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
