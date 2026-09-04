import { useParams } from 'react-router';
import { usePool } from '../api/queries';
import type { PoolUser } from '../api/types';
import { Badge, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { DataTable } from '../components/ui/DataTable';

export function UserPoolPage() {
  const { slug = '' } = useParams();
  const q = usePool(slug);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="User pool"
        subtitle="Accounts leased per worker during a run (@user:<role> or `Given I use a leased user with role`). Passwords are env var names, never values."
      />
      <DataTable<PoolUser>
        data={q.data ?? []}
        columns={[
          {
            header: 'Username',
            accessorKey: 'username',
            cell: (c) => <span className="mono">{c.getValue<string>()}</span>,
          },
          {
            header: 'Role',
            accessorKey: 'role',
            cell: (c) => <Badge tone="blue">{c.getValue<string>()}</Badge>,
          },
          {
            header: 'Secret',
            accessorKey: 'secretRef',
            cell: (c) => (
              <span className="mono muted">
                ${'{'}
                {c.getValue<string>()}
                {'}'}
              </span>
            ),
          },
          {
            header: 'Enabled',
            accessorKey: 'enabled',
            cell: (c) =>
              c.getValue<boolean>() ? (
                <Badge tone="green">yes</Badge>
              ) : (
                <Badge tone="red">no</Badge>
              ),
          },
          {
            header: 'Lease',
            accessorKey: 'leased',
            cell: (c) =>
              c.getValue<boolean>() ? (
                <Badge tone="amber">leased by {c.row.original.leaseOwner}</Badge>
              ) : (
                <Badge>free</Badge>
              ),
          },
        ]}
      />
    </div>
  );
}
