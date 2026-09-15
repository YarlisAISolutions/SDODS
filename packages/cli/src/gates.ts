import pc from 'picocolors';
import type { GateResult } from '@sdods/contracts';
import { SdodsError } from '@sdods/core';
import { out, table } from './ui.js';

/**
 * How a process gate verdict reads on the terminal, and the error a breach fails with. Shared by
 * `sdods run --process` (an unsharded run) and `sdods report merge --process` (the shards of one),
 * so a gate looks the same wherever it was judged.
 */

export function printGates(gates: GateResult): void {
  out('');
  out(pc.bold(`gates · process ${gates.process}`));
  table(
    gates.rows.map((r) => ({
      gate: r.gate,
      threshold: r.threshold,
      actual: r.actual,
      result: r.passed ? 'pass' : 'FAIL',
      detail: r.detail ?? '',
    })),
  );
}

/** The `GATE_FAILED` error for a verdict that did not pass. Exit 1: a gate not met is a failure. */
export function gateFailedError(gates: GateResult, verdictFile: string): SdodsError {
  const failed = gates.rows.filter((r) => !r.passed);
  return new SdodsError(
    'GATE_FAILED',
    `Process "${gates.process}" did not meet ${failed.length} gate(s): ${failed.map((r) => `${r.gate} (${r.actual}, needs ${r.threshold})`).join('; ')}.`,
    {
      hint: `The verdict is in ${verdictFile}. Gates are set under processes[].gates in sdods.project.yaml.`,
      docsPath: '/docs/guides/processes-and-testing-types',
      exitCode: 1,
    },
  );
}
