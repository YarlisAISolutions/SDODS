import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useEnvs, usePool, useProject } from '../api/queries';
import { useSse } from '../api/sse';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { useToast } from '../components/ui/Toast';

export function RecorderPage() {
  const { slug = '' } = useParams();
  const project = useProject(slug);
  const envs = useEnvs(slug);
  const pool = usePool(slug);
  const { canEdit } = useAuth();
  const { toast } = useToast();
  const nav = useNavigate();
  const editable = canEdit(project.data?.workspace, project.data?.organization);
  const [form, setForm] = useState({
    env: '',
    name: '',
    url: '/',
    user: '',
    device: '',
    browser: 'chromium',
    saveHar: false,
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const [spec, setSpec] = useState<{ path: string; content: string } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const start = useMutation({
    mutationFn: () =>
      api<{ jobId: string }>(`/api/projects/${slug}/record`, {
        json: { ...form, env: form.env || project.data?.envs.default },
      }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      setLog([]);
      setSpec(null);
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  useSse<any>(jobId ? `/api/jobs/${jobId}/events` : null, {
    onMessage: (m) => {
      if (m.event === 'log') setLog((l) => [...l, m.data.line]);
      if (m.event === 'done') setSpec({ path: m.data.path, content: m.data.spec });
    },
  });
  const save = useMutation({
    mutationFn: () => api(`/api/projects/${slug}/recorded`, { json: spec }),
    onSuccess: () => toast(`Saved ${spec?.path}`, 'success'),
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const convert = useMutation({
    mutationFn: () =>
      api<{ id: string }>('/api/agents/jobs', {
        json: { project: slug, kind: 'convert-recording', goal: spec?.path },
      }),
    onSuccess: () => nav('/agents'),
  });
  const roles = [...new Set((pool.data ?? []).map((u) => u.role))];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Recorder"
        subtitle="Records a browser session, then post-processes it: fixtures, routes instead of absolute URLs, tags, and login state for a pool user. Runs where the server runs, so a display is required."
      />
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card title="Session">
          <div className="space-y-3">
            <Field label="Environment">
              <Select
                value={form.env || project.data?.envs.default || ''}
                disabled={envs.isLoading}
                onChange={(e) => setForm({ ...form, env: e.target.value })}
              >
                {envs.isLoading && <option>Loading environments…</option>}
                {(envs.data ?? []).map((e) => (
                  <option key={e.name}>{e.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Recording name" hint="becomes recorded/<name>.spec.ts; include the role">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="checkout-standard"
              />
            </Field>
            <Field label="Start URL (route path)">
              <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </Field>
            <Field label="Log in as pool role" hint="storage state is captured once and reused">
              <Select
                value={form.user}
                disabled={pool.isLoading}
                onChange={(e) => setForm({ ...form, user: e.target.value })}
              >
                {pool.isLoading ? (
                  <option>Loading roles…</option>
                ) : (
                  <option value="">— anonymous —</option>
                )}
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Browser">
                <Select
                  value={form.browser}
                  onChange={(e) => setForm({ ...form, browser: e.target.value })}
                >
                  {(project.data?.browsers ?? ['chromium']).map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Device (optional)">
                <Input
                  value={form.device}
                  onChange={(e) => setForm({ ...form, device: e.target.value })}
                  placeholder="iPhone 15"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.saveHar}
                onChange={(e) => setForm({ ...form, saveHar: e.target.checked })}
              />{' '}
              also capture HAR for offline replay
            </label>
            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={!editable || !form.name || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? 'Launching…' : 'Start recording'}
            </Button>
            <div className="muted text-[11px]">
              CLI equivalent:{' '}
              <code className="mono">
                sdods record -p {slug} -e {form.env || project.data?.envs.default} --name{' '}
                {form.name || '<name>'}
                {form.user ? ` --user ${form.user}` : ''}
                {form.device ? ` --device "${form.device}"` : ''}
              </code>
            </div>
          </div>
        </Card>
        <div className="space-y-3">
          <Card title="Progress">
            <pre className="mono max-h-40 overflow-auto text-[12px]">
              {log.join('\n') || (jobId ? 'Waiting for codegen…' : 'No recording started.')}
            </pre>
          </Card>
          <Card
            title={
              <span className="flex items-center gap-2">
                Recorded spec {spec && <Badge className="mono">{spec.path}</Badge>}
              </span>
            }
            actions={
              spec && (
                <>
                  <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                    Save to recorded/
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => convert.mutate()}
                    disabled={convert.isPending}
                  >
                    Convert to feature with agent
                  </Button>
                </>
              )
            }
          >
            <Textarea
              rows={16}
              readOnly
              value={spec?.content ?? ''}
              placeholder="The post-processed TypeScript spec appears here when you close the codegen window."
            />
            <div className="muted mt-2 text-[11px]">
              Re-record the same flow for other roles, environments or devices by changing the form
              and using a distinct name; the `.claude/skills/sdods-record` skill automates the
              matrix.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
