import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { SCOPES, scopesForRole, type Scope } from '@sdods/contracts/scopes';
import { api } from '../api/client';
import { useInvalidate, useMcpInfo, useTokens } from '../api/queries';
import type { ApiToken } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Spinner } from '../components/ui';
import { DataTable } from '../components/ui/DataTable';
import { Dialog } from '../components/ui/Dialog';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/Toast';
import { copyToClipboard, fmtDate, fmtRelative } from '../lib/utils';

const PRESETS: Record<string, Scope[]> = {
  'CI ingest': ['runs:ingest', 'runs:read'],
  'Read only': SCOPES.filter((s) => s.endsWith(':read')) as Scope[],
  'MCP full (role ceiling)': [],
};

export function SettingsPage() {
  const { tab = 'tokens' } = useParams();
  const nav = useNavigate();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="API tokens are free: no quota, no license gate. Scopes are capped by your role."
      />
      <Tabs
        value={tab}
        onChange={(t) => nav(`/settings/${t}`)}
        tabs={[
          { value: 'tokens', label: 'API tokens', content: <TokensTab /> },
          { value: 'mcp', label: 'MCP clients', content: <McpTab /> },
        ]}
      />
    </div>
  );
}

function TokensTab() {
  const { me, isAdmin } = useAuth();
  const [all, setAll] = useState(false);
  const q = useTokens(all);
  const inv = useInvalidate();
  const { toast } = useToast();
  const ceiling = me ? scopesForRole(me.user.role) : [];
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['runs:read']);
  const [expires, setExpires] = useState('90');
  const [revealed, setRevealed] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api<ApiToken & { token: string }>('/api/tokens', {
        json: { name, scopes, expiresInDays: expires === 'never' ? undefined : Number(expires) },
      }),
    onSuccess: (t) => {
      inv(['tokens']);
      setRevealed(t.token);
      setCreating(false);
      setName('');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => inv(['tokens']),
  });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={() => setCreating(true)}>
          New token
        </Button>
        {isAdmin && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all
            users
          </label>
        )}
      </div>
      {revealed && (
        <Card title="Copy your token now" className="border-green-500/50">
          <div className="flex items-center gap-2">
            <code
              className="mono flex-1 break-all rounded bg-[var(--panel-2)] p-2"
              data-testid="revealed-token"
            >
              {revealed}
            </code>
            <Button
              size="sm"
              onClick={() => copyToClipboard(revealed).then(() => toast('Copied', 'success'))}
            >
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
              Dismiss
            </Button>
          </div>
          <div className="mt-1 text-xs text-amber-600">
            It will not be shown again. Use it as `Authorization: Bearer …` or `SDODS_TOKEN`.
          </div>
        </Card>
      )}
      <DataTable<ApiToken>
        data={q.data ?? []}
        columns={[
          { header: 'Name', accessorKey: 'name' },
          {
            header: 'Prefix',
            accessorKey: 'prefix',
            cell: (c) => <span className="mono">{c.getValue<string>()}…</span>,
          },
          {
            header: 'Scopes',
            accessorKey: 'scopes',
            cell: (c) => (
              <span className="flex flex-wrap gap-1">
                {c.getValue<Scope[]>().map((s) => (
                  <Badge key={s} className="mono">
                    {s}
                  </Badge>
                ))}
              </span>
            ),
          },
          {
            header: 'Expires',
            accessorKey: 'expiresAt',
            cell: (c) => (c.getValue<string>() ? fmtDate(c.getValue<string>()) : 'never'),
          },
          {
            header: 'Last used',
            accessorKey: 'lastUsedAt',
            cell: (c) => fmtRelative(c.getValue<string>()),
          },
          ...(all ? [{ header: 'Owner', accessorKey: 'owner' as const }] : []),
          {
            header: '',
            id: 'actions',
            cell: (c) =>
              c.row.original.revokedAt ? (
                <Badge tone="red">revoked</Badge>
              ) : (
                <Button size="sm" variant="danger" onClick={() => revoke.mutate(c.row.original.id)}>
                  Revoke
                </Button>
              ),
          },
        ]}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New API token"
        description="Free and unlimited. Pick the smallest scope set that does the job."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              disabled={!name || scopes.length === 0 || create.isPending}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ci, claude-code, cursor…"
            />
          </Field>
          <Field label="Expiry">
            <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
              {['30', '90', '365'].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
              <option value="never">never</option>
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {Object.entries(PRESETS).map(([label, s]) => (
            <Button
              key={label}
              size="sm"
              onClick={() => setScopes(s.length ? s.filter((x) => ceiling.includes(x)) : ceiling)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {SCOPES.map((s) => {
            const allowed = ceiling.includes(s);
            return (
              <label
                key={s}
                className={`flex items-center gap-1 text-xs ${allowed ? '' : 'opacity-40'}`}
                title={allowed ? '' : 'above your role'}
              >
                <input
                  type="checkbox"
                  disabled={!allowed}
                  checked={scopes.includes(s)}
                  onChange={(e) =>
                    setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))
                  }
                />
                <span className="mono">{s}</span>
              </label>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}

function McpTab() {
  const info = useMcpInfo();
  const [token, setToken] = useState('<YOUR_TOKEN>');
  const [testResult, setTestResult] = useState<string | null>(null);
  const { toast } = useToast();
  const url = info.data?.url ?? `${location.origin}/mcp`;
  const test = useMutation({
    mutationFn: async () => {
      // Streamable HTTP handshake: initialize → notifications/initialized → tools/list,
      // carrying the session id the server assigns. Responses may be JSON or SSE.
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      };
      const rpc = async (payload: unknown) => {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const sid = res.headers.get('mcp-session-id');
        if (sid) headers['mcp-session-id'] = sid;
        const text = await res.text();
        if (!text.trim()) return null;
        if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
          const data = text
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .filter(Boolean)
            .pop();
          return data ? JSON.parse(data) : null;
        }
        return JSON.parse(text);
      };
      await rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'sdods-web', version: '0.1.0' },
        },
      });
      await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const body = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      return body?.result?.tools?.length ?? 0;
    },
    onSuccess: (n) => setTestResult(`✔ connected · ${n} tools`),
    onError: (e) => setTestResult(`✖ ${(e as Error).message}`),
  });
  const snippets: Array<{ label: string; code: string }> = [
    {
      label: 'Claude Code (remote)',
      code: `claude mcp add --transport http sdods ${url} --header "Authorization: Bearer ${token}"`,
    },
    {
      label: 'Claude Code (local stdio)',
      code: `claude mcp add sdods -- npx sdods mcp --project demo-shop --env staging`,
    },
    {
      label: 'JSON config (Claude Desktop, Cursor, Windsurf)',
      code: JSON.stringify(
        {
          mcpServers: {
            sdods: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
          },
        },
        null,
        2,
      ),
    },
    {
      label: 'VS Code .vscode/mcp.json',
      code: JSON.stringify(
        {
          inputs: [
            {
              id: 'sdods-token',
              type: 'promptString',
              description: 'SDODS API token',
              password: true,
            },
          ],
          servers: {
            sdods: {
              type: 'http',
              url,
              headers: { Authorization: 'Bearer ${input:sdods-token}' },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      label: 'Local stdio (any client)',
      code: JSON.stringify(
        { mcpServers: { sdods: { command: 'npx', args: ['sdods', 'mcp'], cwd: '<repo>' } } },
        null,
        2,
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Card title="Endpoint">
        <div className="mono text-sm">{url}</div>
        <div className="muted mt-1 text-xs">
          Streamable HTTP with bearer tokens. Tools are filtered by the token's scopes. Browser
          driving stays with the bundled Playwright MCP (`npx playwright mcp`), installed alongside.
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(info.data?.tools ?? []).map((t) => (
            <Badge key={t.name} className="mono" title={`${t.description} (${t.scope})`}>
              {t.name}
            </Badge>
          ))}
        </div>
      </Card>
      <Card title="Test connection">
        <div className="flex gap-2">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mono"
            aria-label="token"
          />
          <Button onClick={() => test.mutate()} disabled={test.isPending}>
            Test
          </Button>
        </div>
        {testResult && <div className="mt-2 text-xs">{testResult}</div>}
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        {snippets.map((s) => (
          <Card
            key={s.label}
            title={s.label}
            actions={
              <Button
                size="sm"
                onClick={() => copyToClipboard(s.code).then(() => toast('Copied', 'success'))}
              >
                Copy
              </Button>
            }
          >
            <pre className="mono overflow-auto whitespace-pre-wrap rounded bg-[var(--panel-2)] p-2 text-[11px]">
              {s.code}
            </pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
