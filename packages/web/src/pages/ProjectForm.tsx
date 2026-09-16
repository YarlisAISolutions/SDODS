import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { BrowserSchema } from '@sdods/contracts/schemas';
import { api } from '../api/client';
import { useDeleteProject, useInvalidate, useProject } from '../api/queries';
import type { Project } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  TagChip,
  Textarea,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { DeleteProjectDialog } from './Projects';
import { clearProjectPref } from '../lib/project-pref';

const ALL_LAYERS = ['ui', 'api', 'hybrid', 'recorded'] as const;
const ALL_BROWSERS = BrowserSchema.options;
const TESTING_TYPES = [
  'functional',
  'smoke',
  'regression',
  'sanity',
  'integration',
  'contract',
  'visual',
  'accessibility',
  'performance',
  'security',
  'data-driven',
  'exploratory',
] as const;
const TRIGGERS = ['manual', 'pr', 'merge', 'nightly', 'release', 'schedule', 'webhook'] as const;
const POLICIES = ['off', 'on-failure', 'scenario', 'step', 'visual'] as const;

/**
 * Edits an existing project. Creating happens in a dialog on the projects list -- this page posted
 * the whole Project object to `POST /api/projects`, which accepts a fraction of those fields, so
 * everything the user typed beyond the slug was dropped without an error.
 */
export function ProjectFormPage() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const { canEdit, isAdmin } = useAuth();
  const { workspaces } = useWorkspace();
  const q = useProject(slug);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [form, setForm] = useState<Project | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useDeleteProject();
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (p: Project) =>
      api(`/api/projects/${p.slug}`, { method: 'PUT', json: { patch: projectPatch(q.data!, p) } }),
    onSuccess: (_r, p) => {
      inv(['projects'], ['project', p.slug]);
      toast('Project saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!form) return null;
  const editable = canEdit(form.workspace, form.organization);
  const set = (patch: Partial<Project>) => setForm({ ...form, ...patch });
  const toggle = <T extends string>(list: readonly T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <PageHeader
        title={form.name}
        subtitle={`projects/${form.slug}/sdods.project.yaml · workspace ${form.workspace}`}
        actions={
          editable && (
            <Button variant="primary" disabled={save.isPending || !form.slug || !form.name}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          )
        }
      />
      {!editable && (
        <div className="panel border-amber-500/50 p-2 text-xs">
          You have viewer access in this workspace; the form is read-only.
        </div>
      )}
      <fieldset disabled={!editable} className="contents">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identity">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Slug">
                {/* The API refuses a slug change: it is the directory name and the key every
                    run, report and schedule is filed under. */}
                <Input value={form.slug} disabled />
              </Field>
              <Field label="Name">
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field
                label="Workspace"
                hint="only workspaces declared in sdods.workspace.yaml are offered"
              >
                {/* Free text here was a trap: a workspace the workspace file does not declare
                    makes the registry reject every project on the next reload, not just this one.
                    The API refuses it now too; this stops the user reaching for it at all. */}
                <Select value={form.workspace} onChange={(e) => set({ workspace: e.target.value })}>
                  {workspaces.map((w) => (
                    <option key={w.slug} value={w.slug}>
                      {w.name}
                    </option>
                  ))}
                  {/* A project already pointing somewhere unlisted must still render its value,
                      or opening Settings would silently rewrite it on save. */}
                  {!workspaces.some((w) => w.slug === form.workspace) && (
                    <option value={form.workspace}>{form.workspace}</option>
                  )}
                </Select>
              </Field>
              <Field label="Test id attribute">
                <Input
                  value={form.testIdAttribute}
                  onChange={(e) => set({ testIdAttribute: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                rows={2}
                value={form.description ?? ''}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
          </Card>
          <Card title="Layers and browsers">
            <div className="mb-2 text-xs muted">
              Every scenario carries exactly one layer tag; browsers apply to UI, hybrid and
              recorded layers.
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_LAYERS.map((l) => (
                <label key={l} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.layers.includes(l)}
                    onChange={() => set({ layers: toggle(form.layers, l) as Project['layers'] })}
                  />{' '}
                  {l}
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ALL_BROWSERS.map((b) => (
                <label key={b} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.browsers.includes(b)}
                    onChange={() =>
                      set({ browsers: toggle(form.browsers, b) as Project['browsers'] })
                    }
                  />{' '}
                  {b}
                </label>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Default environment">
                <Select
                  value={form.envs.default}
                  onChange={(e) => set({ envs: { ...form.envs, default: e.target.value } })}
                >
                  {form.envs.available.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Available environments" hint="comma separated">
                <Input
                  value={form.envs.available.join(', ')}
                  onChange={(e) =>
                    set({
                      envs: {
                        ...form.envs,
                        available: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </Field>
            </div>
          </Card>
        </div>

        <Card title="Tag policy">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Suites (exactly one per scenario)">
              <Input
                value={form.tags.suites.join(', ')}
                onChange={(e) => set({ tags: { ...form.tags, suites: splitList(e.target.value) } })}
              />
            </Field>
            <Field label="Extra tags">
              <Input
                value={form.tags.extra.join(', ')}
                onChange={(e) => set({ tags: { ...form.tags, extra: splitList(e.target.value) } })}
              />
            </Field>
            <Field label="User roles (for @user:<role>)">
              <Input
                value={form.tags.roles.join(', ')}
                onChange={(e) => set({ tags: { ...form.tags, roles: splitList(e.target.value) } })}
              />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {[
              '@ui',
              '@api',
              '@hybrid',
              ...form.tags.suites.map((s) => `@${s}`),
              ...form.tags.extra.map((s) => `@${s}`),
            ].map((t) => (
              <TagChip key={t} tag={t} />
            ))}
          </div>
        </Card>

        <Card title="Screenshot policy" actions={<Badge>by suite tag</Badge>}>
          <div className="grid gap-3 sm:grid-cols-4">
            {Object.entries(form.screenshots.policy).map(([tag, policy]) => (
              <Field key={tag} label={tag}>
                <Select
                  value={policy}
                  onChange={(e) =>
                    set({
                      screenshots: {
                        ...form.screenshots,
                        policy: { ...form.screenshots.policy, [tag]: e.target.value },
                      },
                    })
                  }
                >
                  {POLICIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Field label="Mask selectors" hint="comma separated">
              <Input
                value={form.screenshots.mask.join(', ')}
                onChange={(e) =>
                  set({ screenshots: { ...form.screenshots, mask: splitList(e.target.value) } })
                }
              />
            </Field>
            <Field label="Viewport width">
              <Input
                type="number"
                value={form.screenshots.viewport.width}
                onChange={(e) =>
                  set({
                    screenshots: {
                      ...form.screenshots,
                      viewport: { ...form.screenshots.viewport, width: Number(e.target.value) },
                    },
                  })
                }
              />
            </Field>
            <Field label="Viewport height">
              <Input
                type="number"
                value={form.screenshots.viewport.height}
                onChange={(e) =>
                  set({
                    screenshots: {
                      ...form.screenshots,
                      viewport: { ...form.screenshots.viewport, height: Number(e.target.value) },
                    },
                  })
                }
              />
            </Field>
            <label className="flex items-center gap-2 self-end text-sm">
              <input
                type="checkbox"
                checked={form.screenshots.onlyOnFailure}
                onChange={(e) =>
                  set({ screenshots: { ...form.screenshots, onlyOnFailure: e.target.checked } })
                }
              />{' '}
              only on failure (cost control)
            </label>
          </div>
        </Card>

        <Card
          title="Modules"
          actions={
            <Button
              size="sm"
              type="button"
              onClick={() =>
                set({
                  modules: [
                    ...form.modules,
                    {
                      name: `module-${form.modules.length + 1}`,
                      testingTypes: ['functional'],
                      tags: [],
                      routes: [],
                      endpoints: [],
                    },
                  ],
                })
              }
            >
              Add module
            </Button>
          }
        >
          <div className="muted mb-2 text-xs">
            A module is a feature area (auth, inventory, checkout…) that owns
            features/&lt;module&gt;/, default tags and testing types. Lint warns when scenarios miss
            the module tags.
          </div>
          <div className="space-y-3">
            {form.modules.map((m, i) => (
              <div key={i} className="panel-2 rounded-md p-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  <Field label="Name">
                    <Input
                      value={m.name}
                      onChange={(e) =>
                        set({ modules: replaceAt(form.modules, i, { ...m, name: e.target.value }) })
                      }
                    />
                  </Field>
                  <Field label="Path" hint="default features/<name>">
                    <Input
                      value={m.path ?? ''}
                      onChange={(e) =>
                        set({
                          modules: replaceAt(form.modules, i, {
                            ...m,
                            path: e.target.value || undefined,
                          }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Tags">
                    <Input
                      value={m.tags.join(', ')}
                      onChange={(e) =>
                        set({
                          modules: replaceAt(form.modules, i, {
                            ...m,
                            tags: splitList(e.target.value),
                          }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Owner">
                    <Input
                      value={m.owner ?? ''}
                      onChange={(e) =>
                        set({
                          modules: replaceAt(form.modules, i, {
                            ...m,
                            owner: e.target.value || undefined,
                          }),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TESTING_TYPES.map((t) => (
                    <label key={t} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={m.testingTypes.includes(t)}
                        onChange={() =>
                          set({
                            modules: replaceAt(form.modules, i, {
                              ...m,
                              testingTypes: toggle(m.testingTypes, t) as typeof m.testingTypes,
                            }),
                          })
                        }
                      />{' '}
                      {t}
                    </label>
                  ))}
                  <button
                    type="button"
                    className="ml-auto text-xs text-red-500 hover:underline"
                    onClick={() => set({ modules: form.modules.filter((_, j) => j !== i) })}
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Processes"
          actions={
            <Button
              size="sm"
              type="button"
              onClick={() =>
                set({
                  processes: [
                    ...form.processes,
                    {
                      name: `process-${form.processes.length + 1}`,
                      trigger: 'manual',
                      failOnFlaky: false,
                      gates: { perfBudgets: false, a11y: false },
                      notify: [],
                    },
                  ],
                })
              }
            >
              Add process
            </Button>
          }
        >
          <div className="muted mb-2 text-xs">
            Named run recipes: `sdods run --process &lt;name&gt;`. Workspace defaults apply unless a
            project process has the same name.
          </div>
          <div className="space-y-3">
            {form.processes.map((p, i) => (
              <div key={i} className="panel-2 rounded-md p-3">
                <div className="grid gap-2 sm:grid-cols-5">
                  <Field label="Name">
                    <Input
                      value={p.name}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, { ...p, name: e.target.value }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Trigger">
                    <Select
                      value={p.trigger}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            trigger: e.target.value as typeof p.trigger,
                          }),
                        })
                      }
                    >
                      {TRIGGERS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Tags expression">
                    <Input
                      value={p.tags ?? ''}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            tags: e.target.value || undefined,
                          }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Browsers">
                    <Input
                      value={(p.browsers ?? []).join(', ')}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            browsers: splitList(e.target.value) as typeof p.browsers,
                          }),
                        })
                      }
                    />
                  </Field>
                  <Field label="Min pass rate %">
                    <Input
                      type="number"
                      value={p.gates.minPassRate ?? ''}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            gates: {
                              ...p.gates,
                              minPassRate: e.target.value ? Number(e.target.value) : undefined,
                            },
                          }),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.failOnFlaky}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            failOnFlaky: e.target.checked,
                          }),
                        })
                      }
                    />{' '}
                    fail on flaky
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.gates.perfBudgets}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            gates: { ...p.gates, perfBudgets: e.target.checked },
                          }),
                        })
                      }
                    />{' '}
                    perf budgets gate
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.gates.a11y}
                      onChange={(e) =>
                        set({
                          processes: replaceAt(form.processes, i, {
                            ...p,
                            gates: { ...p.gates, a11y: e.target.checked },
                          }),
                        })
                      }
                    />{' '}
                    a11y gate
                  </label>
                  <span className="muted">notify: {p.notify.join(', ') || '—'}</span>
                  <button
                    type="button"
                    className="ml-auto text-red-500 hover:underline"
                    onClick={() => set({ processes: form.processes.filter((_, j) => j !== i) })}
                  >
                    remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Integrations">
            <div className="muted text-xs">
              GitHub and Jira settings and MCP servers are edited on the Integrations page; secrets
              are referenced by env var name only.
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {form.integrations.github && (
                <Badge tone={form.integrations.github.enabled ? 'green' : 'neutral'}>
                  github {form.integrations.github.enabled ? 'on' : 'off'}
                </Badge>
              )}
              {form.integrations.jira && (
                <Badge tone={form.integrations.jira.enabled ? 'green' : 'neutral'}>
                  jira {form.integrations.jira.enabled ? 'on' : 'off'}
                </Badge>
              )}
              {Object.keys(form.mcp.servers).map((s) => (
                <Badge key={s} tone="blue">
                  mcp:{s}
                </Badge>
              ))}
            </div>
          </Card>
          <Card title="Routes">
            <div className="muted mb-2 text-xs">
              Named routes used by `I navigate to the "&lt;route&gt;" page` and page objects.
            </div>
            <Textarea
              rows={4}
              value={Object.entries(form.routes)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
              onChange={(e) =>
                set({
                  routes: Object.fromEntries(
                    e.target.value
                      .split('\n')
                      .map((l) => l.split(':').map((s) => s.trim()))
                      .filter((p) => p[0] && p[1])
                      .map(([k, ...v]) => [k, v.join(':')]),
                  ),
                })
              }
            />
          </Card>
        </div>
      </fieldset>

      {isAdmin && (
        <Card title="Danger zone">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <div className="font-medium">Delete this project</div>
              <div className="muted mt-0.5">
                Moves <span className="mono">projects/{form.slug}</span> to{' '}
                <span className="mono">.sdods/trash</span> and removes its schedules. Past runs stay
                in history.
              </div>
            </div>
            {/* type=button: this sits inside the settings form, and the default would submit it. */}
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              data-testid="delete-project"
            >
              Delete project
            </Button>
          </div>
        </Card>
      )}

      <DeleteProjectDialog
        project={confirmingDelete ? form : null}
        onClose={() => setConfirmingDelete(false)}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={(s) =>
          remove.mutate(s, {
            onSuccess: () => {
              toast(`Deleted ${s}`, 'success');
              clearProjectPref(s);
              setConfirmingDelete(false);
              nav('/projects');
            },
          })
        }
      />
    </form>
  );
}

const splitList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const replaceAt = <T,>(arr: T[], i: number, v: T) => arr.map((x, j) => (j === i ? v : x));

/** Keys of the Project view that are written back to sdods.project.yaml under the same name. */
const EDITABLE_KEYS = [
  'name',
  'description',
  'workspace',
  'layers',
  'browsers',
  'testIdAttribute',
  'envs',
  'tags',
  'routes',
  'modules',
  'screenshots',
  'processes',
] as const;

/**
 * Only what the form changed. The view carries resolved values the yaml does not have: defaults
 * filled in, and processes inherited from the workspace. Sending the whole view wrote those into
 * the project file (and the server rejected the shape anyway).
 */
export function projectPatch(initial: Project, edited: Project): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (JSON.stringify(initial[key]) === JSON.stringify(edited[key])) continue;
    const value = edited[key];
    patch[key] = key === 'description' && value === '' ? null : value;
  }
  return patch;
}
