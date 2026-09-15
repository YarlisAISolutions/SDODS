import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryDb, ensureProject, migrateToLatest, readJson, upsertRun } from '@sdods/db';
import { runFiles, type GateResult } from '@sdods/contracts';
import type { ServerConfig } from '../src/config.js';
import { RunManager, type RunJob } from '../src/services/run-manager.js';

/**
 * The CLI ingests a run's results before it judges the process gates, so ingest records the run as
 * `passed` and only the run manager is left to record that a gate failed it. Without this the web
 * UI would show a gated-out release as green.
 */
async function setup(gates: GateResult | undefined) {
  const adb = createMemoryDb();
  await migrateToLatest(adb);
  const artifactsDir = mkdtempSync(join(tmpdir(), 'sdods-gates-srv-'));
  const projectId = await ensureProject(adb.db, adb.driver, 'shop');
  const runId = '01a0a299-cd98-7a8b-9a72-e9abc67bbf58';
  await upsertRun(adb.db, adb.driver, {
    id: runId,
    projectId,
    envName: 'staging',
    status: 'passed',
    exitCode: 0,
    totals: { total: 1, passed: 1 },
  });
  mkdirSync(join(artifactsDir, runId), { recursive: true });
  if (gates) writeFileSync(join(artifactsDir, runId, runFiles.gates), JSON.stringify(gates));
  const manager = new RunManager({ artifactsDir } as ServerConfig, adb);
  const job = { runId, status: 'failed', exitCode: 1 } as RunJob;
  const row = async () =>
    adb.db.selectFrom('runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
  return { manager, job, row };
}

describe('RunManager.recordGates', () => {
  it('marks a run a gate failed as failed, with the gate in the error and in totals', async () => {
    const gates: GateResult = {
      process: 'release-gate',
      passed: false,
      rows: [
        { gate: 'minPassRate', threshold: '≥ 100%', actual: '100% (1/1)', passed: true },
        {
          gate: 'perfBudgets',
          threshold: 'no budget breach',
          actual: '0 breach(es) in 0 scenario(s)',
          passed: false,
        },
      ],
    };
    const { manager, job, row } = await setup(gates);
    await manager.recordGates(job);
    const r = await row();
    expect(r.status).toBe('failed');
    expect(r.exit_code).toBe(1);
    expect(r.error_text).toContain('GATE_FAILED');
    expect(r.error_text).toContain('perfBudgets');
    const totals = readJson<Record<string, unknown>>(r.totals_json)!;
    expect(totals.passed).toBe(1);
    expect((totals.gates as GateResult).passed).toBe(false);
  });

  it('records passing gates without touching the status', async () => {
    const { manager, job, row } = await setup({ process: 'pr-check', passed: true, rows: [] });
    await manager.recordGates({ ...job, status: 'passed', exitCode: 0 });
    const r = await row();
    expect(r.status).toBe('passed');
    expect((readJson<Record<string, unknown>>(r.totals_json)!.gates as GateResult).process).toBe(
      'pr-check',
    );
  });

  it('does nothing for a run without a gate verdict', async () => {
    const { manager, job, row } = await setup(undefined);
    await manager.recordGates(job);
    expect((await row()).status).toBe('passed');
  });
});
