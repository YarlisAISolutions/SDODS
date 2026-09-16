import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { BrowserSchema, type Layer } from '@sdods/contracts/schemas';
import { useCreateProject } from '../../api/queries';
import type { BrowserName, CreateProjectInput } from '../../api/types';
import { useWorkspace } from '../../context/WorkspaceContext';
import { Dialog } from '../ui/Dialog';
import { Badge, Button, ErrorBox, Field, Input, Select, Textarea } from '../ui';
import { useToast } from '../ui/Toast';

const ALL_LAYERS: Layer[] = ['ui', 'api', 'hybrid', 'recorded'];
const ALL_BROWSERS = BrowserSchema.options as readonly BrowserName[];

/**
 * The standard configuration a project needs to be runnable. Everything richer -- tags, routes,
 * modules, processes, screenshot policy -- lives on the settings page, which is where this sends
 * you next.
 *
 * These fields are exactly what `POST /api/projects` accepts. That body is strict, so adding one
 * here without adding it there is a 400 rather than a silently dropped value (which is how the old
 * full-page form lost every field but the slug).
 */
const blank = (workspace: string): CreateProjectInput => ({
  slug: '',
  name: '',
  description: '',
  workspace,
  layers: ['ui', 'api', 'hybrid'],
  browsers: ['chromium'],
  env: 'local',
  uiUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:3000/api',
  testId: 'data-testid',
});

export function NewProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const { toast } = useToast();
  const { workspace, workspaces } = useWorkspace();
  const [form, setForm] = useState<CreateProjectInput>(() => blank(workspace?.slug ?? ''));
  const create = useCreateProject();

  useEffect(() => {
    if (open) {
      setForm(blank(workspace?.slug ?? ''));
      create.reset();
    }
    // `create` is a stable mutation object; re-running on it would clear errors as they arrive.
  }, [open, workspace?.slug]);

  const set = <K extends keyof CreateProjectInput>(key: K, value: CreateProjectInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggle = <K extends 'layers' | 'browsers'>(key: K, value: string) =>
    setForm((f) => {
      const current = (f[key] ?? []) as string[];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...f, [key]: next } as CreateProjectInput;
    });

  const valid = Boolean(form.slug && form.workspace && form.layers?.length);

  const submit = () => {
    if (!valid) return;
    create.mutate(
      {
        ...form,
        // A blank string is not "no description"; it would fail the server's min-length rules and
        // write an empty key into the yaml.
        name: form.name?.trim() || undefined,
        description: form.description?.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast(`Created ${form.slug}`, 'success');
          onOpenChange(false);
          nav(`/projects/${form.slug}/edit`);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="New project"
      description="Creates projects/<slug>/sdods.project.yaml with features, steps, pages and a first environment."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!valid || create.isPending}
            data-testid="create-project"
          >
            {create.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Slug" hint="lowercase, digits and dashes">
            <Input
              value={form.slug}
              autoFocus
              data-testid="project-slug"
              onChange={(e) =>
                set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
              }
            />
          </Field>
          <Field label="Name" hint="defaults to the slug, title-cased">
            <Input value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            rows={2}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        <Field
          label="Workspace"
          hint="must be declared in sdods.workspace.yaml — the list only offers ones that are"
        >
          <Select value={form.workspace ?? ''} onChange={(e) => set('workspace', e.target.value)}>
            {workspaces.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <span className="text-xs font-medium muted">Layers</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ALL_LAYERS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => toggle('layers', l)}
                aria-pressed={form.layers?.includes(l)}
              >
                <Badge tone={form.layers?.includes(l) ? 'blue' : undefined}>{l}</Badge>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-medium muted">Browsers</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {ALL_BROWSERS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => toggle('browsers', b)}
                aria-pressed={form.browsers?.includes(b)}
              >
                <Badge tone={form.browsers?.includes(b) ? 'blue' : undefined}>{b}</Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="First environment">
            <Input value={form.env ?? ''} onChange={(e) => set('env', e.target.value)} />
          </Field>
          <Field label="UI base URL">
            <Input value={form.uiUrl ?? ''} onChange={(e) => set('uiUrl', e.target.value)} />
          </Field>
          <Field label="API base URL">
            <Input value={form.apiUrl ?? ''} onChange={(e) => set('apiUrl', e.target.value)} />
          </Field>
        </div>

        <Field label="Test id attribute" hint="locators prefer this over CSS">
          <Input value={form.testId ?? ''} onChange={(e) => set('testId', e.target.value)} />
        </Field>

        {create.error ? <ErrorBox error={create.error} /> : null}
      </form>
    </Dialog>
  );
}
