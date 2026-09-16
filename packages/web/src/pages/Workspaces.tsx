import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useInvalidate, useOrgMembers, useWorkspaceMembers } from '../api/queries';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  RoleBadge,
  Select,
  SkeletonList,
  Textarea,
} from '../components/ui';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { WORKSPACE_ROLES } from '@sdods/contracts/scopes';

export function WorkspacesPage() {
  const { org, workspaces, workspace, setWorkspace } = useWorkspace();
  const { me, isAdmin } = useAuth();
  const inv = useInvalidate();
  const { toast } = useToast();
  const orgRole = org ? me?.orgRoles[org.slug] : undefined;
  const canManageOrg = isAdmin || orgRole === 'owner' || orgRole === 'admin';
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', description: '' });
  const create = useMutation({
    mutationFn: () => api('/api/workspaces', { json: { ...form, organization: org?.slug } }),
    onSuccess: () => {
      inv(['workspaces']);
      setCreating(false);
      toast('Workspace created', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const orgMembers = useOrgMembers(org?.slug ?? '');

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Workspaces of ${org?.name ?? '…'}`}
        subtitle="One organization holds many workspaces. Your role in each workspace is the higher of your explicit membership and the role implied by your organization role."
        actions={
          canManageOrg && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              New workspace
            </Button>
          )
        }
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((w) => (
          <Card
            key={w.slug}
            title={
              <span className="flex items-center gap-2">
                {w.name} <RoleBadge role={w.myRole} />
              </span>
            }
            actions={
              <Button
                size="sm"
                variant={workspace?.slug === w.slug ? 'primary' : 'default'}
                onClick={() => setWorkspace(w.slug)}
              >
                {workspace?.slug === w.slug ? 'Selected' : 'Select'}
              </Button>
            }
          >
            <div className="muted text-xs">{w.description ?? 'No description'}</div>
            <div className="mt-2 text-xs">
              <Badge>
                {w.projectCount} project{w.projectCount === 1 ? '' : 's'}
              </Badge>{' '}
              <Badge className="mono">{w.slug}</Badge>
            </div>
            <MembersEditor
              workspace={w.slug}
              canManage={
                isAdmin || w.myRole === 'admin' || orgRole === 'owner' || orgRole === 'admin'
              }
            />
          </Card>
        ))}
      </div>

      <Card title={`Organization members · ${org?.name ?? ''}`}>
        <div className="muted mb-2 text-xs">
          Organization roles: owner and admin manage every workspace; member gets viewer access to
          all workspaces unless a workspace grants more.
        </div>
        {orgMembers.isLoading && <SkeletonList rows={3} className="px-0" />}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {(orgMembers.data ?? []).map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-1.5">
              <span>{m.username}</span>
              <RoleBadge role={m.role} />
            </li>
          ))}
        </ul>
      </Card>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New workspace"
        description="Added to sdods.workspace.yaml. Projects join it with `workspace: <slug>` in sdods.project.yaml, or pick it when you create or import one."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              disabled={!form.slug || !form.name || create.isPending}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Slug" hint="lowercase, digits and dashes">
            <Input
              value={form.slug}
              onChange={(e) =>
                setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })
              }
            />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </form>
      </Dialog>
    </div>
  );
}

function MembersEditor({ workspace, canManage }: { workspace: string; canManage: boolean }) {
  const members = useWorkspaceMembers(workspace);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<string>('viewer');
  const add = useMutation({
    mutationFn: () => api(`/api/workspaces/${workspace}/members`, { json: { username, role } }),
    onSuccess: () => {
      inv(['wsMembers', workspace]);
      setUsername('');
      toast('Member saved', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/workspaces/${workspace}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => inv(['wsMembers', workspace]),
  });
  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="mb-1 text-[11px] font-medium muted">Members</div>
      <ul className="space-y-1 text-xs">
        {members.isLoading && <SkeletonList rows={2} className="p-0" />}
        {(members.data ?? []).map((m) => (
          <li key={m.userId} className="flex items-center justify-between">
            <span>{m.username}</span>
            <span className="flex items-center gap-1">
              <RoleBadge role={m.role} />
              {canManage && (
                <button
                  type="button"
                  className="muted hover:text-red-500"
                  onClick={() => remove.mutate(m.userId)}
                  aria-label={`remove ${m.username}`}
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
        {members.data?.length === 0 && (
          <li className="muted">No explicit members (organization roles apply).</li>
        )}
      </ul>
      {canManage && (
        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (username) add.mutate();
          }}
        >
          <Input
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="username"
          />
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-28"
            aria-label="role"
          >
            {WORKSPACE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!username || add.isPending}>
            Add
          </Button>
        </form>
      )}
    </div>
  );
}
