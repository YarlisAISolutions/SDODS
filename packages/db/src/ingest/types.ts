import type { RunManifest, RunTotals, SuiteStatus } from '@sdods/contracts/types';
import type { SdodsDb } from '../create-db.js';

export type { RunManifest, RunTotals, SuiteStatus };

export interface IngestRunOptions {
  runId: string;
  /** slug used when the manifest is absent and project names cannot be parsed */
  projectSlug?: string;
  manifest?: RunManifest | null;
  ndjsonPaths?: string[];
  runnerJsonPaths?: string[];
  /** root that contains `<runId>/…` (default `.sdods/runs`) */
  artifactsRoot: string;
  replace?: boolean;
  /** git/ci/trigger overrides when there is no manifest */
  trigger?: string;
  env?: string;
}

export interface IngestResult {
  runId: string;
  projectSlug: string;
  totals: RunTotals;
  status: string;
  scenarios: number;
  attempts: number;
  steps: number;
  artifacts: number;
  healEvents: number;
  filesIngested: string[];
  filesSkipped: string[];
  parseErrors: number;
}

export interface IngestContext {
  adb: SdodsDb;
  runId: string;
  projectId: string;
  projectSlug: string;
  artifactsRoot: string;
  runDir: string;
  workspaceId: string | null;
}

/** cucumber Timestamp/Duration → ms */
export function tsToMs(t?: { seconds: number | string; nanos: number } | null): number | null {
  if (!t) return null;
  return Number(t.seconds) * 1000 + Math.round((t.nanos ?? 0) / 1e6);
}

export function tsToIso(t?: { seconds: number | string; nanos: number } | null): string | null {
  const ms = tsToMs(t);
  return ms === null ? null : new Date(ms).toISOString();
}

export function cucumberStatus(s: string | undefined): SuiteStatus {
  switch ((s ?? '').toUpperCase()) {
    case 'PASSED':
      return 'passed';
    case 'FAILED':
      return 'failed';
    case 'SKIPPED':
    case 'PENDING':
    case 'UNDEFINED':
    case 'AMBIGUOUS':
      return 'skipped';
    default:
      return 'unknown';
  }
}

export function runnerStatus(s: string | undefined): SuiteStatus {
  switch (s) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'timedOut':
      return 'timedOut';
    case 'skipped':
      return 'skipped';
    case 'interrupted':
      return 'interrupted';
    default:
      return 'unknown';
  }
}

/** Module = first directory after `features/`, else the first directory segment. */
export function moduleFromUri(uri: string): string | null {
  const segs = uri.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const fi = segs.lastIndexOf('features');
  if (fi >= 0 && fi < segs.length - 2) return segs[fi + 1]!;
  if (fi >= 0) return null;
  // non-feature files (recorded specs): the directory that holds the file
  return segs[segs.length - 2]!;
}

/** Strip playwright-bdd's `[<project>]:` prefix from a feature uri. */
export function splitUri(uri: string): { runnerProject: string | null; uri: string } {
  const m = /^\[([^\]]+)\]:(.*)$/.exec(uri);
  return m ? { runnerProject: m[1]!, uri: m[2]! } : { runnerProject: null, uri };
}

const LOCATOR_PATTERNS = [
  /locator\.\w+: Timeout[\s\S]*?waiting for (locator\([^)]*\)|getBy\w+\([^)]*\)|[^\n]+)/i,
  /waiting for (locator\([^\n]*?\)|getBy\w+\([^\n]*?\))/i,
  /strict mode violation: (locator\([^\n]*?\)|getBy\w+\([^\n]*?\))/i,
  /expect\((locator\([^\n]*?\)|getBy\w+\([^\n]*?\))\)/i,
];

/** Extract the selector from a Playwright locator error message, if any. */
export function selectorFromError(message: string | undefined | null): string | null {
  if (!message) return null;
  for (const re of LOCATOR_PATTERNS) {
    const m = re.exec(message);
    if (m?.[1]) return m[1].trim().slice(0, 300);
  }
  return null;
}

export function emptyTotals(): RunTotals {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    timedOut: 0,
    flaky: 0,
    healed: 0,
    durationMs: 0,
  };
}
