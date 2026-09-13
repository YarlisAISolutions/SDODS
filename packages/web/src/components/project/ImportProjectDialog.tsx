import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useImportPreview, useImportProject } from '../../api/queries';
import type { ImportPreview, ImportSourceKind } from '../../api/types';
import { useWorkspace } from '../../context/WorkspaceContext';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../ui/Dialog';
import { Badge, Button, ErrorBox, Field, Input, Select } from '../ui';
import { useToast } from '../ui/Toast';

const KINDS: Array<{ id: ImportSourceKind; label: string; hint: string }> = [
  {
    id: 'path',
    label: 'Folder on this machine',
    hint: 'Absolute path to a folder containing sdods.project.yaml, or a repository that holds one.',
  },
  { id: 'zip', label: 'Zip archive', hint: 'Upload a .zip of the project folder.' },
  { id: 'git', label: 'Git repository', hint: 'Cloned shallowly, then imported.' },
];

/**
 * Register a project that already exists.
 *
 * There is deliberately no "Browse…" button. The desktop window navigates to the server-rendered
 * SPA, and that page has no Electron preload, so no native file picker is reachable from here --
 * the path is typed and the preview below is the feedback loop that tells you whether it was
 * right. Zip upload covers the case where the project is not on the server's own filesystem.
 */
export function ImportProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const { workspace, workspaces } = useWorkspace();

  const [kind, setKind] = useState<ImportSourceKind>('path');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState('');
  const [ws, setWs] = useState(workspace?.slug ?? '');
  const [found, setFound] = useState<ImportPreview | null>(null);

  const preview = useImportPreview();
  const run = useImportProject();

  useEffect(() => {
    if (!open) return;
    setKind('path');
    setSource('');
    setFile(null);
    setSlug('');
    setWs(workspace?.slug ?? '');
    setFound(null);
    preview.reset();
    run.reset();
    // The mutation objects are stable; including them would reset state as results arrive.
  }, [open, workspace?.slug]);

  // A path or git source is read with the server's own credentials, so the API restricts those two
  // to admins. Say so here rather than letting the user fill the form and collect a 403.
  const needsAdmin = kind !== 'zip' && !isAdmin;
  const hasSource = kind === 'zip' ? Boolean(file) : source.trim().length > 0;

  // Debounced, because it clones a git repo or walks a directory on the server.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setFound(null);
    if (!open || !hasSource || needsAdmin) return;
    // A zip is only re-read on demand: uploading the archive twice to preview it is wasteful.
    if (kind === 'zip') return;
    timer.current = setTimeout(() => {
      preview.mutate(
        { kind, source: source.trim(), slug: slug || undefined, workspace: ws || undefined },
        { onSuccess: setFound },
      );
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, kind, source, ws, hasSource, needsAdmin]);

  const submit = () => {
    if (!hasSource || needsAdmin) return;
    run.mutate(
      {
        kind,
        source: source.trim() || undefined,
        file,
        slug: slug || undefined,
        workspace: ws || undefined,
      },
      {
        onSuccess: (project) => {
          toast(`Imported ${project.slug}`, 'success');
          onOpenChange(false);
          nav(`/projects/${project.slug}/edit`);
        },
      },
    );
  };

  const active = KINDS.find((k) => k.id === kind)!;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import a project"
      description="Brings an existing SDODS project into this workspace and re-homes it."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!hasSource || needsAdmin || run.isPending}
            data-testid="import-project"
          >
            {run.isPending ? 'Importing…' : 'Import'}
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
        <div>
          <span className="text-xs font-medium muted">Source</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                aria-pressed={kind === k.id}
                data-testid={`import-kind-${k.id}`}
              >
                <Badge tone={kind === k.id ? 'blue' : undefined}>{k.label}</Badge>
              </button>
            ))}
          </div>
          <div className="muted mt-1 text-xs">{active.hint}</div>
        </div>

        {needsAdmin && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            Reading a folder or a git URL happens on the server, so it is limited to admins. Upload
            a zip archive instead, or ask an admin to import it.
          </div>
        )}

        {kind === 'zip' ? (
          <Field label="Archive" hint=".zip of the project folder">
            <Input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="import-file"
            />
          </Field>
        ) : (
          <Field
            label={kind === 'git' ? 'Repository URL' : 'Folder path'}
            hint={
              kind === 'git'
                ? 'https://… or git@… — must be reachable from the server'
                : 'as the server sees it, e.g. /Users/you/work/acme-tests'
            }
          >
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={needsAdmin}
              placeholder={
                kind === 'git' ? 'https://github.com/you/acme-tests.git' : '/path/to/project'
              }
              data-testid="import-source"
            />
          </Field>
        )}

        {preview.isPending && <div className="muted text-xs">Looking…</div>}
        {found && (
          <div className="rounded-md border border-line bg-[var(--panel-2)] p-2 text-xs">
            <div className="font-medium">
              Detected {found.name}{' '}
              <span className="mono muted">
                {found.slug} · {found.files} files
              </span>
            </div>
            <div className="muted mt-0.5">
              layers {found.layers.join(', ')} · envs {found.envs.join(', ')}
            </div>
            {found.collides && (
              <div className="mt-1 text-amber-600 dark:text-amber-400">
                A project called {found.slug} is already here. Give it another slug below, or the
                import is refused.
              </div>
            )}
          </div>
        )}
        {/* A failed preview is information, not an error state: the path may just be half-typed. */}
        {preview.error && hasSource ? (
          <div className="muted text-xs">
            Nothing readable there yet — {String((preview.error as Error).message ?? '')}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Slug"
            hint={found ? `defaults to ${found.slug}` : 'leave blank to keep its own'}
          >
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder={found?.slug ?? ''}
              data-testid="import-slug"
            />
          </Field>
          <Field label="Workspace" hint="the imported yaml is re-homed to this workspace">
            <Select value={ws} onChange={(e) => setWs(e.target.value)}>
              {workspaces.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {run.error ? <ErrorBox error={run.error} /> : null}
      </form>
    </Dialog>
  );
}
