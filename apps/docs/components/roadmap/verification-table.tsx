/**
 * The checks behind the delivered chapters, each with the command that produced it.
 *
 * Printing the invocation next to the number is the point: a reader can repeat the measurement
 * instead of trusting it, and a figure that has gone stale is obvious rather than invisible.
 */
import { VERIFICATION } from '@sdods/roadmap';

export function RoadmapVerification() {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-fd-border">
      <table className="w-full text-sm">
        <thead className="bg-fd-muted text-left">
          <tr>
            <th className="px-3 py-2 font-semibold">Check</th>
            <th className="px-3 py-2 font-semibold">Result</th>
            <th className="px-3 py-2 font-semibold">Measured</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-fd-border">
          {VERIFICATION.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="px-3 py-2">
                <p>{row.label}</p>
                <code className="font-mono text-xs text-fd-muted-foreground">{row.command}</code>
                {row.note ? (
                  <p className="mt-1 text-xs text-fd-muted-foreground">{row.note}</p>
                ) : null}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{row.result}</td>
              <td className="px-3 py-2 font-mono text-xs text-fd-muted-foreground">
                {row.measuredOn}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
