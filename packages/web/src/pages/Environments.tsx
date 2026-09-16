import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useEnvs, useInvalidate, useProject } from '../api/queries';
import type { Environment } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, Spinner } from '../components/ui';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';

export function EnvironmentsPage() {
  const { slug = '' } = useParams();
  const q = useEnvs(slug);
  const project = useProject(slug);
  const { canEdit } = useAuth();
  const editable = canEdit(project.data?.workspace, project.data?.organization);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [isNew, setIsNew] = useState(false);
  // One upsert route for both: PUT /envs/:name creates the file when it is missing and edits the
  // listed fields in place when it exists. Its body is the flat EnvBody, not the Environment view.
  const save = useMutation({
    mutationFn: (e: Environment) => {
      if (isNew && (q.data ?? []).some((x) => x.name === e.name))
        throw new Error(`Environment ${e.name} already exists.`);
      return api(`/api/projects/${slug}/envs/${encodeURIComponent(e.name)}`, {
        method: 'PUT',
        json: {
          uiUrl: e.ui.baseUrl,
          apiUrl: e.api.baseUrl,
          poolSize: e.users?.poolSize,
          vars: e.vars ?? {},
        },
      });
    },
    onSuccess: () => {
      inv(['envs', slug]);
      setEditing(null);
      toast('Environment saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Environments"
        subtitle={`projects/${slug}/envs/<name>.yaml · secrets are referenced as \${VAR} and read from .env.<name> or the process`}
        actions={
          editable && (
            <Button
              variant="primary"
              onClick={() => {
                setIsNew(true);
                setEditing({
                  name: '',
                  ui: { baseUrl: 'http://localhost:3000' },
                  api: { baseUrl: 'http://localhost:3000/api', auth: { type: 'none' } },
                  users: { poolSize: 2 },
                  vars: {},
                  secretNames: [],
                  secretsPresent: {},
                  isDefault: false,
                });
              }}
            >
              Add environment
            </Button>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-2">
        {(q.data ?? []).map((e) => (
          <Card
            key={e.name}
            title={
              <span className="flex items-center gap-2">
                {e.name} {e.isDefault && <Badge tone="purple">default</Badge>}
              </span>
            }
            actions={
              editable && (
                <Button
                  size="sm"
                  onClick={() => {
                    setIsNew(false);
                    setEditing(e);
                  }}
                >
                  Edit
                </Button>
              )
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="muted">UI</dt>
              <dd className="mono">{e.ui.baseUrl}</dd>
              <dt className="muted">API</dt>
              <dd className="mono">{e.api.baseUrl}</dd>
              <dt className="muted">API auth</dt>
              <dd>{e.api.auth?.type ?? 'none'}</dd>
              <dt className="muted">Pool size</dt>
              <dd>{e.users?.poolSize ?? '—'}</dd>
              <dt className="muted">Vars</dt>
              <dd>{Object.keys(e.vars ?? {}).join(', ') || '—'}</dd>
              <dt className="muted">Secrets</dt>
              <dd className="flex flex-wrap gap-1">
                {e.secretNames.length === 0 && '—'}
                {e.secretNames.map((n) => (
                  <Badge
                    key={n}
                    tone={e.secretsPresent[n] ? 'green' : 'red'}
                    className="mono"
                    title={
                      e.secretsPresent[n] ? 'present in server env' : `set ${n} in .env.${e.name}`
                    }
                  >
                    {n} {e.secretsPresent[n] ? '✓' : '✗'}
                  </Badge>
                ))}
              </dd>
            </dl>
          </Card>
        ))}
      </div>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isNew ? 'Add environment' : `Edit ${editing?.name}`}
        description="Values here are written to the yaml file. Secrets stay in .env files; reference them as ${VAR}."
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => editing && save.mutate(editing)}
              disabled={!editing?.name || save.isPending}
            >
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={editing.name}
                disabled={!isNew}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <Field label="Pool size">
              <Input
                type="number"
                value={editing.users?.poolSize ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    users: { poolSize: Number(e.target.value) || undefined },
                  })
                }
              />
            </Field>
            <Field label="UI base URL">
              <Input
                value={editing.ui.baseUrl}
                onChange={(e) => setEditing({ ...editing, ui: { baseUrl: e.target.value } })}
              />
            </Field>
            <Field label="API base URL">
              <Input
                value={editing.api.baseUrl}
                onChange={(e) =>
                  setEditing({ ...editing, api: { ...editing.api, baseUrl: e.target.value } })
                }
              />
            </Field>
            <Field label="Vars (key: value per line)" hint="use ${VAR} for secrets">
              <textarea
                className="mono w-full rounded-md border border-line bg-[var(--panel)] p-2"
                rows={4}
                value={Object.entries(editing.vars ?? {})
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n')}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    vars: Object.fromEntries(
                      e.target.value
                        .split('\n')
                        .map((l) => l.split(':'))
                        .filter((p) => p[0]?.trim())
                        .map(([k, ...v]) => [k!.trim(), v.join(':').trim()]),
                    ),
                  })
                }
              />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
