import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Skeleton } from './index';

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  emptyText = 'Nothing here yet.',
  dense,
  isLoading,
  skeletonRows = 3,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyText?: string;
  dense?: boolean;
  /** While true the table shows placeholder rows instead of `emptyText`, which would read as "no results". */
  isLoading?: boolean;
  skeletonRows?: number;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="panel-2 text-left text-xs muted">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className={cn(
                    'cursor-pointer select-none px-3 font-medium',
                    dense ? 'py-1.5' : 'py-2',
                  )}
                  onClick={h.column.getToggleSortingHandler()}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? null}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {isLoading &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={`skeleton-${i}`} className="border-t border-line" aria-hidden>
                {columns.map((_c, ci) => (
                  <td key={ci} className={cn('px-3 align-middle', dense ? 'py-1.5' : 'py-2')}>
                    <Skeleton className="h-3.5 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          {!isLoading && table.getRowModel().rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-xs muted">
                {emptyText}
              </td>
            </tr>
          )}
          {table.getRowModel().rows.map((r) => (
            <tr
              key={r.id}
              className={cn(
                'border-t border-line',
                onRowClick && 'cursor-pointer hover:bg-[var(--panel-2)]',
              )}
              onClick={onRowClick ? () => onRowClick(r.original) : undefined}
            >
              {r.getVisibleCells().map((c) => (
                <td key={c.id} className={cn('px-3 align-middle', dense ? 'py-1.5' : 'py-2')}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
