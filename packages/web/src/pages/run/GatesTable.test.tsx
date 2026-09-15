import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { normalizeRunDetail } from '../../api/normalize';
import type { GateResult } from '../../api/types';
import { GatesTable } from './GatesTable';

const gates: GateResult = {
  process: 'release-gate',
  passed: false,
  rows: [
    { gate: 'minPassRate', threshold: '≥ 100%', actual: '66.7% (2/3)', passed: false },
    {
      gate: 'a11y',
      threshold: 'no blocking violation',
      actual: '0 blocking in 2 audit(s)',
      passed: true,
    },
  ],
};

describe('gate verdict on the run page (#176)', () => {
  it('reads the verdict ingest stored under totals_json.gates, falling back to summary.json', () => {
    const fromDb = normalizeRunDetail({
      run: { id: 'r1', projectSlug: 'shop', env: 'staging', totals: { total: 3, gates } },
      scenarios: [],
    });
    expect(fromDb.gates).toEqual(gates);
    const fromRecord = normalizeRunDetail({ run: { id: 'r2', gates }, scenarios: [] });
    expect(fromRecord.gates?.process).toBe('release-gate');
    const fromSummary = normalizeRunDetail({
      run: { id: 'r3' },
      summary: { gates },
      scenarios: [],
    });
    expect(fromSummary.gates?.passed).toBe(false);
    expect(normalizeRunDetail({ run: { id: 'r4' }, scenarios: [] }).gates).toBeUndefined();
  });

  it('renders one row per gate with its result', () => {
    render(<GatesTable gates={gates} />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('minPassRate')).toBeTruthy();
    expect(within(rows[0]!).getByText('FAIL')).toBeTruthy();
    expect(within(rows[1]!).getByText('pass')).toBeTruthy();
    expect(within(rows[1]!).getByText('0 blocking in 2 audit(s)')).toBeTruthy();
  });
});
