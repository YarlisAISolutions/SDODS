import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useDatasets, useInvalidate, useProject } from '../api/queries';
import type { Dataset } from '../api/types';
import { useAuth } from '../auth/AuthContext';
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
} from '../components/ui';
import { DataTable } from '../components/ui/DataTable';
import { Dialog } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';

export function DatasetsPage() {
  const { slug = '' } = useParams();
  const q = useDatasets(slug);
  const project = useProject(slug);
  const { canEdit } = useAuth();
  const editable = canEdit(project.data?.workspace, project.data?.organization);
  const inv = useInvalidate();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [envKey, setEnvKey] = useState('*');
  const [storage, setStorage] = useState<'file' | 'db'>('file');
  const [preview, setPreview] = useState<{
    columns: string[];
    rows: Record<string, unknown>[];
  } | null>(null);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const rows = useQuery({
    queryKey: ['datasetRows', slug, selected?.id],
    queryFn: () =>
      api<{ rows: Record<string, unknown>[]; total: number }>(
        `/api/projects/${slug}/datasets/${selected!.id}/rows?limit=50`,
      ),
    enabled: Boolean(selected),
  });

  // One route for both: `preview=1` parses without saving. Fields go before the file because the
  // server reads the multipart stream only up to the file part.
  const doPreview = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData();
      form.append('preview', '1');
      form.append('file', f);
      return api<{ columns: string[]; rows: Record<string, unknown>[] }>(
        `/api/projects/${slug}/datasets`,
        { form },
      );
    },
    onSuccess: (p) => setPreview(p),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('name', name);
      form.append('env', envKey);
      form.append('storage', storage);
      form.append('file', file!);
      return api(`/api/projects/${slug}/datasets`, { form });
    },
    onSuccess: () => {
      inv(['datasets', slug]);
      setUploading(false);
      setFile(null);
      setPreview(null);
      toast('Dataset imported', 'success');
    },
    onError: (e) => toast((e as Error).message, 'error'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Datasets"
        subtitle="CSV, JSON, YAML, DB tables and faker factories; resolved per environment with data/common fallback"
        actions={
          editable && (
            <Button variant="primary" onClick={() => setUploading(true)}>
              Upload
            </Button>
          )
        }
      />
      <DataTable<Dataset>
        data={q.data ?? []}
        onRowClick={setSelected}
        columns={[
          {
            header: 'Name',
            accessorKey: 'name',
            cell: (c) => <span className="mono">{c.getValue<string>()}</span>,
          },
          {
            header: 'Env',
            accessorKey: 'envKey',
            cell: (c) => <Badge>{c.getValue<string>()}</Badge>,
          },
          { header: 'Kind', accessorKey: 'kind' },
          { header: 'Storage', accessorKey: 'storage' },
          {
            header: 'Columns',
            accessorKey: 'columns',
            cell: (c) => c.getValue<string[]>().join(', '),
          },
          { header: 'Rows', accessorKey: 'rowCount' },
          {
            header: 'Source',
            accessorKey: 'sourcePath',
            cell: (c) => <span className="mono muted">{c.getValue<string>() ?? '(db)'}</span>,
          },
        ]}
      />
      {selected && (
        <Card
          title={`Rows · ${selected.name}`}
          actions={
            <Button size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          }
        >
          {rows.isLoading ? (
            <Spinner />
          ) : (
            <PreviewGrid columns={selected.columns} rows={rows.data?.rows ?? []} />
          )}
          <div className="muted mt-2 text-[11px]">
            Password-like columns are masked by the server.
          </div>
        </Card>
      )}
      <Dialog
        open={uploading}
        onOpenChange={setUploading}
        title="Upload dataset"
        wide
        footer={
          <>
            <Button onClick={() => setUploading(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => upload.mutate()}
              disabled={!file || !name || upload.isPending}
            >
              Import
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="File (csv, json, yaml)">
            <Input
              type="file"
              accept=".csv,.json,.yaml,.yml"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) {
                  if (!name) setName(f.name.replace(/\.[^.]+$/, ''));
                  doPreview.mutate(f);
                }
              }}
            />
          </Field>
          <Field label="Dataset name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Environment key" hint="* = every environment">
            <Select value={envKey} onChange={(e) => setEnvKey(e.target.value)}>
              <option value="*">*</option>
              {project.data?.envs.available.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Field label="Storage">
            <Select value={storage} onChange={(e) => setStorage(e.target.value as 'file' | 'db')}>
              <option value="file">file (data/&lt;env&gt;/…)</option>
              <option value="db">database (datasets table)</option>
            </Select>
          </Field>
        </div>
        {preview && (
          <div className="mt-3">
            <div className="mb-1 text-xs muted">Preview (first rows)</div>
            <PreviewGrid columns={preview.columns} rows={preview.rows} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

function PreviewGrid({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="overflow-auto rounded border border-line">
      <table className="w-full text-xs">
        <thead className="panel-2">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {columns.map((c) => (
                <td key={c} className="mono px-2 py-1">
                  {String(r[c] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
