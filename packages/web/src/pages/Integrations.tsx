import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useIntegrations, useInvalidate, useProject } from '../api/queries';
import type { IntegrationView } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';

export function IntegrationsPage() {
  const { slug = '' } = useParams();
  const q = useIntegrations(slug);
  const project = useProject(slug);
  const { isAdmin, workspaceRole } = useAuth();
  const canManage =
    isAdmin || workspaceRole(project.data?.workspace ?? '', project.data?.organization) === 'admin';
  const [tab, setTab] = useState('issues');
  if (q.isLoading) return <Spinner />;
  const items = q.data ?? [];
  const issue = items.filter((i) => i.provider === 'github' || i.provider === 'jira');
  const mcp = items.filter((i) => i.provider.startsWith('mcp:'));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrations"
        subtitle="Secrets are referenced by environment variable name; the server reports whether each is present. Test before you rely on them."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: 'issues',
            label: 'GitHub & Jira',
            content: (
              <div className="grid gap-3 lg:grid-cols-2">
                {issue.map((i) => (
                  <ProviderCard key={i.provider} slug={slug} item={i} canManage={canManage} />
                ))}
                {issue.length === 0 && (
                  <div className="muted text-xs">
                    No GitHub/Jira configuration in this project yaml.
                  </div>
                )}
              </div>
            ),
          },
          {
            value: 'mcp',
            label: 'MCP servers',
            count: mcp.length,
            content: <McpServers slug={slug} items={mcp} canManage={canManage} />,
          },
        ]}
      />
    </div>
  );
}

function ProviderCard({
  slug,
  item,
  canManage,
}: {
  slug: string;
  item: IntegrationView;
  canManage: boolean;
}) {
  const inv = useInvalidate();
  const { toast } = useToast();
  const [cfg, setCfg] = useState<Record<string, unknown>>(item.config);
  const [enabled, setEnabled] = useState(item.enabled);
  const [testResult, setTestResult] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/projects/${slug}/integrations/${item.provider}`, {
        method: 'PUT',
        json: { enabled, config: cfg, secretEnv: item.secretEnv },
      }),
    onSuccess: () => {
      inv(['integrations', slug]);
      toast('Saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; detail: string }>(
        `/api/projects/${slug}/integrations/${item.provider}/test`,
        { method: 'POST' },
      ),
    onSuccess: (r) => setTestResult(`${r.ok ? '✔' : '✖'} ${r.detail}`),
  });
  const sync = useMutation({
    mutationFn: () =>
      api<{ synced: number }>(`/api/projects/${slug}/integrations/sync`, { method: 'POST' }),
    onSuccess: (r) => toast(`Synced ${r.synced} link(s)`, 'success'),
  });
  const fields =
    item.provider === 'github'
      ? ['owner', 'repo', 'createIssueOnFailure', 'labels']
      : ['baseUrl', 'projectKey', 'issueType', 'createIssueOnFailure', 'transitionOnPass'];
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span className="capitalize">{item.provider}</span>
          <Badge tone={enabled ? 'green' : 'neutral'}>{enabled ? 'enabled' : 'disabled'}</Badge>
        </span>
      }
      actions={
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManage}
            onChange={(e) => setEnabled(e.target.checked)}
          />{' '}
          enabled
        </label>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) =>
          f === 'createIssueOnFailure' ? (
            <Field key={f} label={f}>
              <Select
                value={String(cfg[f] ?? 'never')}
                disabled={!canManage}
                onChange={(e) => setCfg({ ...cfg, [f]: e.target.value })}
              >
                {['never', 'smoke', 'always'].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field key={f} label={f}>
              <Input
                value={
                  Array.isArray(cfg[f]) ? (cfg[f] as string[]).join(', ') : String(cfg[f] ?? '')
                }
                disabled={!canManage}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    [f]:
                      f === 'labels'
                        ? e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : e.target.value,
                  })
                }
              />
            </Field>
          ),
        )}
        {item.provider === 'github' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(cfg.checkRun)}
                disabled={!canManage}
                onChange={(e) => setCfg({ ...cfg, checkRun: e.target.checked })}
              />{' '}
              check run per browser
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(cfg.prComment)}
                disabled={!canManage}
                onChange={(e) => setCfg({ ...cfg, prComment: e.target.checked })}
              />{' '}
              one PR comment per run
            </label>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-1 text-xs">
        {Object.entries(item.secretEnv).map(([k, v]) => (
          <Badge
            key={k}
            tone={item.secretsPresent[v] ? 'green' : 'red'}
            className="mono"
            title={
              item.secretsPresent[v]
                ? 'present in server environment'
                : 'missing in server environment'
            }
          >
            {k} ← ${'{'}
            {v}
            {'}'} {item.secretsPresent[v] ? '✓' : '✗'}
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          Test connection
        </Button>
        <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
          Sync issue links
        </Button>
        {canManage && (
          <Button
            size="sm"
            variant="primary"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            Save
          </Button>
        )}
        {testResult && <span className="text-xs">{testResult}</span>}
      </div>
    </Card>
  );
}

function McpServers({
  slug,
  items,
  canManage,
}: {
  slug: string;
  items: IntegrationView[];
  canManage: boolean;
}) {
  const inv = useInvalidate();
  const { toast } = useToast();
  const [draft, setDraft] = useState<{
    name: string;
    transport: 'stdio' | 'http';
    command: string;
    args: string;
    url: string;
    allowedTools: string;
    envFrom: string;
  } | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const test = useMutation({
    mutationFn: (name: string) =>
      api<{ ok: boolean; detail: string; tools?: string[] }>(
        `/api/projects/${slug}/integrations/${name}/test`,
        { method: 'POST' },
      ),
    onSuccess: (r, name) =>
      setResults((s) => ({
        ...s,
        [name]: `${r.ok ? '✔' : '✖'} ${r.detail}${r.tools ? ` · tools: ${r.tools.join(', ')}` : ''}`,
      })),
  });
  const save = useMutation({
    mutationFn: () => {
      const d = draft!;
      const envFrom = Object.fromEntries(
        d.envFrom
          .split('\n')
          .map((l) => l.split('=').map((s) => s.trim()))
          .filter((p) => p[0] && p[1]),
      );
      const bad = Object.values(envFrom).find((v) => !/^[A-Z][A-Z0-9_]*$/.test(v as string));
      if (bad)
        throw new Error(
          `"${bad}" looks like a value; envFrom must map to environment variable NAMES.`,
        );
      const config =
        d.transport === 'stdio'
          ? {
              transport: 'stdio',
              command: d.command,
              args: d.args.split(/\s+/).filter(Boolean),
              allowedTools: d.allowedTools
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {
              transport: 'http',
              url: d.url,
              allowedTools: d.allowedTools
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            };
      return api(`/api/projects/${slug}/integrations/mcp:${d.name}`, {
        method: 'PUT',
        json: { enabled: true, config, secretEnv: envFrom },
      });
    },
    onSuccess: () => {
      inv(['integrations', slug]);
      setDraft(null);
      toast('MCP server saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  return (
    <div className="space-y-3">
      <div className="muted text-xs">
        Servers the agents may consume for this project (the bundled Playwright MCP drives a
        browser; GitHub/Jira MCP servers are optional). Secrets are env var names only.
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((i) => (
          <Card
            key={i.provider}
            title={<span className="mono">{i.provider}</span>}
            actions={
              <Badge tone={i.enabled ? 'green' : 'neutral'}>
                {i.enabled ? 'enabled' : 'disabled'}
              </Badge>
            }
          >
            <pre className="mono panel-2 rounded p-2 text-[11px]">
              {JSON.stringify(i.config, null, 2)}
            </pre>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {Object.entries(i.secretEnv).map(([k, v]) => (
                <Badge key={k} tone={i.secretsPresent[v] ? 'green' : 'red'} className="mono">
                  {k} ← ${'{'}
                  {v}
                  {'}'}
                </Badge>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => test.mutate(i.provider)} disabled={test.isPending}>
                Test
              </Button>
              {results[i.provider] && <span className="text-xs">{results[i.provider]}</span>}
            </div>
          </Card>
        ))}
      </div>
      {canManage && !draft && (
        <Button
          onClick={() =>
            setDraft({
              name: '',
              transport: 'stdio',
              command: 'npx',
              args: '',
              url: '',
              allowedTools: '',
              envFrom: '',
            })
          }
        >
          Add MCP server
        </Button>
      )}
      {draft && (
        <Card title="New MCP server">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Transport">
              <Select
                value={draft.transport}
                onChange={(e) =>
                  setDraft({ ...draft, transport: e.target.value as 'stdio' | 'http' })
                }
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
              </Select>
            </Field>
            {draft.transport === 'stdio' ? (
              <>
                <Field label="Command">
                  <Input
                    value={draft.command}
                    onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  />
                </Field>
                <Field label="Args">
                  <Input
                    value={draft.args}
                    onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-github"
                  />
                </Field>
              </>
            ) : (
              <Field label="URL">
                <Input
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
              </Field>
            )}
            <Field label="Allowed tools (comma)">
              <Input
                value={draft.allowedTools}
                onChange={(e) => setDraft({ ...draft, allowedTools: e.target.value })}
              />
            </Field>
            <Field
              label="envFrom / headersFrom (CHILD=ENV_VAR_NAME per line)"
              hint="values must be env var names, never secrets"
            >
              <Textarea
                rows={2}
                value={draft.envFrom}
                onChange={(e) => setDraft({ ...draft, envFrom: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-2 flex gap-2">
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              disabled={!draft.name || save.isPending}
            >
              Save
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
