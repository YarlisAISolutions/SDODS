export {
  collectGateEvidence,
  evaluateGates,
  gateReportsFromRunnerJson,
  gateTotalsFromRunnerStats,
  hasGates,
  ingestGateJudge,
  type GateEvidence,
  type GateResult,
  type GateRow,
  type GateTotals,
} from './gates.js';
export type { A11yPageReport, A11yScenarioReport, A11yScenarioStatus } from './a11y-scenario.js';
export type { PerfBreach, PerfScenarioReport } from './perf-scenario.js';
