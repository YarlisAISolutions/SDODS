import type { GateResult } from '../../api/types';

/** The same table `sdods run --process` and `sdods report merge --process` print. */
export function GatesTable({ gates }: { gates: GateResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="muted text-xs">
          <tr>
            <th className="py-1 pr-3 font-normal">gate</th>
            <th className="py-1 pr-3 font-normal">threshold</th>
            <th className="py-1 pr-3 font-normal">actual</th>
            <th className="py-1 pr-3 font-normal">result</th>
            <th className="py-1 font-normal">detail</th>
          </tr>
        </thead>
        <tbody>
          {gates.rows.map((r) => (
            <tr key={r.gate} className="align-top">
              <td className="mono py-1 pr-3">{r.gate}</td>
              <td className="py-1 pr-3">{r.threshold}</td>
              <td className="py-1 pr-3">{r.actual}</td>
              <td className={`py-1 pr-3 ${r.passed ? 'status-passed' : 'status-failed'}`}>
                {r.passed ? 'pass' : 'FAIL'}
              </td>
              <td className="muted py-1 text-xs">{r.detail ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
