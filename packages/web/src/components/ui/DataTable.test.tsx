import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './DataTable';

interface Row {
  name: string;
  runs: number;
}

const rows: Row[] = [
  { name: 'checkout', runs: 12 },
  { name: 'auth', runs: 3 },
  { name: 'cart-v10', runs: 40 },
];

const columns: DataTableColumn<Row>[] = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Runs', accessorKey: 'runs', cell: (c) => `${c.getValue<number>()} runs` },
];

const firstColumn = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((tr) => within(tr).getAllByRole('cell')[0]!.textContent);

describe('DataTable', () => {
  it('renders every row through the column cell renderers', () => {
    render(<DataTable<Row> data={rows} columns={columns} />);
    expect(firstColumn()).toEqual(['checkout', 'auth', 'cart-v10']);
    expect(screen.getByText('40 runs')).toBeInTheDocument();
  });

  it('sorts a column ascending, then descending, when its header is clicked', () => {
    render(<DataTable<Row> data={rows} columns={columns} />);
    fireEvent.click(screen.getByText('Name'));
    expect(firstColumn()).toEqual(['auth', 'cart-v10', 'checkout']);
    fireEvent.click(screen.getByText(/Name/));
    expect(firstColumn()).toEqual(['checkout', 'cart-v10', 'auth']);
  });

  it('sorts numbers by value rather than as text', () => {
    render(<DataTable<Row> data={rows} columns={columns} />);
    fireEvent.click(screen.getByText('Runs'));
    const runs = screen
      .getAllByRole('row')
      .slice(1)
      .map((tr) => within(tr).getAllByRole('cell')[1]!.textContent);
    // Numbers sort descending first by default, as they did in v8.
    expect(runs).toEqual(['40 runs', '12 runs', '3 runs']);
  });

  it('shows the empty text, or skeleton rows while loading, and passes the row to onRowClick', () => {
    const onRowClick = vi.fn();
    const { rerender } = render(
      <DataTable<Row> data={[]} columns={columns} emptyText="No runs yet." />,
    );
    expect(screen.getByText('No runs yet.')).toBeInTheDocument();

    rerender(<DataTable<Row> data={[]} columns={columns} isLoading emptyText="No runs yet." />);
    expect(screen.queryByText('No runs yet.')).not.toBeInTheDocument();

    rerender(<DataTable<Row> data={rows} columns={columns} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText('auth'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });
});
