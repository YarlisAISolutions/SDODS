import { MIN_PASSWORD_LENGTH } from '@sdods/contracts/names';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ROLES, type Role } from '@sdods/contracts/scopes';
import { api } from '../api/client';
import { useInvalidate, useUsers } from '../api/queries';
import type { UserRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  RoleBadge,
  Select,
  Spinner,
} from '../components/ui';
import { DataTable } from '../components/ui/DataTable';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { fmtRelative } from '../lib/utils';

export function UsersPage() {
  const { isAdmin } = useAuth();
  const q = useUsers();
  const inv = useInvalidate();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{
    username: string;
    email: string;
    password: string;
    role: Role;
  }>({ username: '', email: '', password: '', role: 'viewer' });
  const create = useMutation({
    mutationFn: () => api('/api/users', { json: form }),
    onSuccess: () => {
      inv(['users']);
      setCreating(false);
      toast('User created', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; active?: boolean }) =>
      api(`/api/users/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => inv(['users']),
  });
  if (!isAdmin)
    return (
      <div className="panel p-4 text-sm">
        Only platform admins manage users. Workspace admins manage members on the Workspaces page.
      </div>
    );
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        subtitle="Platform roles are the baseline; organization and workspace memberships refine access per workspace."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New user
          </Button>
        }
      />
      <DataTable<UserRow>
        data={q.data ?? []}
        columns={[
          { header: 'Username', accessorKey: 'username' },
          {
            header: 'Display name',
            accessorKey: 'displayName',
            cell: (c) => c.getValue<string>() || '—',
          },
          { header: 'Email', accessorKey: 'email', cell: (c) => c.getValue<string>() ?? '—' },
          {
            header: 'Role',
            accessorKey: 'role',
            cell: (c) => (
              <Select
                className="w-28"
                value={c.getValue<Role>()}
                onChange={(e) =>
                  patch.mutate({ id: c.row.original.id, role: e.target.value as Role })
                }
                aria-label={`role of ${c.row.original.username}`}
              >
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            ),
          },
          {
            header: 'Active',
            accessorKey: 'active',
            cell: (c) =>
              c.getValue<boolean>() ? (
                <Badge tone="green">active</Badge>
              ) : (
                <Badge tone="red">disabled</Badge>
              ),
          },
          {
            header: 'Last login',
            accessorKey: 'lastLoginAt',
            cell: (c) => fmtRelative(c.getValue<string>()),
          },
          {
            header: '',
            id: 'actions',
            cell: (c) => (
              <Button
                size="sm"
                onClick={() =>
                  patch.mutate({ id: c.row.original.id, active: !c.row.original.active })
                }
              >
                {c.row.original.active ? 'Disable' : 'Enable'}
              </Button>
            ),
          },
        ]}
      />
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="New user"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              disabled={
                !form.username || form.password.length < MIN_PASSWORD_LENGTH || create.isPending
              }
            >
              Create
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username">
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Password" hint={`at least ${MIN_PASSWORD_LENGTH} characters`}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          <Field label="Platform role">
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 text-xs muted">
          Roles: <RoleBadge role="viewer" /> read everything · <RoleBadge role="editor" /> run, edit
          features, data, schedules, agents · <RoleBadge role="admin" /> everything incl. users,
          tokens, integrations.
        </div>
      </Dialog>
    </div>
  );
}
