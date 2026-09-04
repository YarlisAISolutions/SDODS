import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HealEvent } from '@sdods/contracts';
import type { HealHistoryEntry } from './types.js';

/** Cross-run memory of successful heals (file-backed; DB-backed variant lives in @sdods/db). */
export class HealHistory {
  private entries = new Map<string, HealHistoryEntry>();

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as HealHistoryEntry[];
        for (const e of raw) this.entries.set(e.description, e);
      } catch {
        /* ignore corrupt history */
      }
    }
  }

  bonus(strategy: string, selector: string): number {
    for (const e of this.entries.values()) {
      if (e.lastStrategy === strategy && e.lastSelector === selector) {
        const total = e.successes + e.failures;
        return total ? Math.min(0.1, (e.successes / total) * 0.1) : 0;
      }
    }
    return 0;
  }

  record(event: HealEvent) {
    const e = this.entries.get(event.description) ?? {
      description: event.description,
      successes: 0,
      failures: 0,
    };
    if (event.succeeded) {
      e.successes++;
      e.lastStrategy = event.strategyUsed ?? undefined;
      e.lastSelector = event.healedSelector ?? undefined;
    } else e.failures++;
    this.entries.set(event.description, e);
  }

  save(file = this.file) {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify([...this.entries.values()], null, 2));
  }

  list(): HealHistoryEntry[] {
    return [...this.entries.values()];
  }
}
