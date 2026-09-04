import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { HealEvent } from '@automax/contracts';
import { scenarioFiles } from '@automax/contracts';

export interface HealReportRow {
  description: string;
  occurrences: number;
  succeeded: number;
  strategies: Record<string, number>;
  suggestedSelector?: string;
  originalSelector: string;
  firstSeen: string;
  lastSeen: string;
  scenarios: string[];
}

/** Recursively collect heal.jsonl files under a run dir (or all runs). */
export function collectHealEvents(root: string): HealEvent[] {
  const events: HealEvent[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name === scenarioFiles.healLog) {
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line) as HealEvent);
          } catch {
            /* skip corrupt line */
          }
        }
      }
    }
  };
  walk(root, 0);
  return events;
}

export function summarizeHealEvents(events: HealEvent[]): HealReportRow[] {
  const byKey = new Map<string, HealReportRow>();
  for (const e of events) {
    const key = `${e.description}|${e.originalSelector}`;
    const row = byKey.get(key) ?? {
      description: e.description,
      originalSelector: e.originalSelector,
      occurrences: 0,
      succeeded: 0,
      strategies: {},
      firstSeen: e.at,
      lastSeen: e.at,
      scenarios: [],
    };
    row.occurrences++;
    if (e.succeeded) {
      row.succeeded++;
      if (e.strategyUsed)
        row.strategies[e.strategyUsed] = (row.strategies[e.strategyUsed] ?? 0) + 1;
      if (e.healedSelector) row.suggestedSelector = e.healedSelector;
    }
    if (e.at < row.firstSeen) row.firstSeen = e.at;
    if (e.at > row.lastSeen) row.lastSeen = e.at;
    if (e.fingerprint && !row.scenarios.includes(e.fingerprint)) row.scenarios.push(e.fingerprint);
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.occurrences - a.occurrences);
}
