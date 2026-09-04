import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import {
  fingerprint as makeFingerprint,
  newId,
  parseRunnerProjectName,
} from '@sdods/contracts/ids';
import { enc, nowIso } from '../col.js';
import { artifactKindFor, parseAttachmentName, storeFile, targetFileFor } from './attachments.js';
import type { LocatorCounter } from './finalize.js';
import { moduleFromUri, runnerStatus, selectorFromError, type IngestContext } from './types.js';

export interface RunnerJsonCounts {
  scenarios: number;
  attempts: number;
  steps: number;
  artifacts: number;
}

/** Ingest a Playwright `json` reporter file (recorded layer / plain specs) into the same tables. */
export async function ingestRunnerJson(
  ctx: IngestContext,
  file: string,
  locatorCounters: Map<string, LocatorCounter>,
): Promise<RunnerJsonCounts & { startedAt: string | null; finishedAt: string | null }> {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const counts: RunnerJsonCounts = { scenarios: 0, attempts: 0, steps: 0, artifacts: 0 };
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  const { db, driver } = ctx.adb;
  const rootDir: string = report.config?.rootDir ?? dirname(file);

  const walk = async (suite: any) => {
    for (const s of suite.suites ?? []) await walk(s);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const runnerProject: string = test.projectName ?? test.projectId ?? 'recorded';
        const parts = parseRunnerProjectName(runnerProject);
        const slug = parts?.project ?? ctx.projectSlug;
        const layer = parts?.layer ?? 'recorded';
        const browser = parts?.browser ?? null;
        const specFile = String(spec.file ?? suite.file ?? 'unknown.spec.ts').replace(/\\/g, '/');
        const title: string = spec.title ?? test.title ?? 'untitled';
        const fp = makeFingerprint({
          project: slug,
          featureUri: specFile,
          scenarioName: title,
          exampleIndex: null,
          layer,
        });
        const naturalKey = `${runnerProject}:${test.id ?? `${specFile}:${spec.line ?? 0}`}`;
        const tags: string[] = (spec.tags ?? test.tags ?? []).map((t: string) =>
          t.startsWith('@') ? t : `@${t}`,
        );

        let scenarioId: string;
        const existing = await db
          .selectFrom('scenarios')
          .select(['id'])
          .where('run_id', '=', ctx.runId)
          .where('natural_key', '=', naturalKey)
          .executeTakeFirst();
        if (existing) scenarioId = existing.id;
        else {
          scenarioId = newId();
          await db
            .insertInto('scenarios')
            .values({
              id: scenarioId,
              run_id: ctx.runId,
              project_id: ctx.projectId,
              natural_key: naturalKey,
              fingerprint: fp,
              source: 'runner-json',
              feature_uri: specFile,
              feature_name: suite.title ?? basename(specFile),
              scenario_name: title,
              module: moduleFromUri(specFile),
              examples_row: null,
              runner_project: runnerProject,
              layer,
              browser,
              suite_tag: tags.find((t) => ['@smoke', '@regression', '@sanity'].includes(t)) ?? null,
              tags_json: enc.json(tags),
              jira_keys_json: enc.json(
                tags.filter((t) => t.startsWith('@jira:')).map((t) => t.slice(6)),
              ),
              status: 'unknown',
              attempts_count: 0,
              flaky: enc.bool(driver, false) as number,
              duration_ms: null,
              error_message: null,
              error_stack: null,
              started_at: null,
              finished_at: null,
              created_at: nowIso(),
              updated_at: nowIso(),
            })
            .execute();
          counts.scenarios++;
        }

        for (const result of test.results ?? []) {
          const retry = Number(result.retry ?? 0);
          const tcsId = `${test.id ?? naturalKey}#${retry}`;
          const status = runnerStatus(result.status);
          const started = result.startTime ? new Date(result.startTime).toISOString() : null;
          const finished =
            started && typeof result.duration === 'number'
              ? new Date(Date.parse(started) + result.duration).toISOString()
              : null;
          startedAt =
            !startedAt || (started && started < startedAt) ? (started ?? startedAt) : startedAt;
          finishedAt =
            !finishedAt || (finished && finished > finishedAt)
              ? (finished ?? finishedAt)
              : finishedAt;
          const errorMessage: string | null =
            result.error?.message ?? result.errors?.[0]?.message ?? null;
          const errorStack: string | null =
            result.error?.stack ?? result.errors?.[0]?.stack ?? null;
          if (status === 'failed' || status === 'timedOut') {
            const selector = selectorFromError(errorStack ?? errorMessage);
            if (selector) {
              const c = locatorCounters.get(selector) ?? { fails: 0, heals: 0, uses: 0 };
              c.fails++;
              c.uses++;
              locatorCounters.set(selector, c);
            }
          }
          let attemptId: string;
          const ex = await db
            .selectFrom('scenario_attempts')
            .select(['id'])
            .where('run_id', '=', ctx.runId)
            .where('test_case_started_id', '=', tcsId)
            .executeTakeFirst();
          const values = {
            attempt: retry,
            status,
            duration_ms: typeof result.duration === 'number' ? result.duration : null,
            error_message: errorMessage ? errorMessage.split('\n')[0]!.slice(0, 2000) : null,
            error_stack: errorStack,
            will_be_retried: enc.bool(
              driver,
              (status === 'failed' || status === 'timedOut') && retry < Number(test.retries ?? 0),
            ) as number,
            worker_index: typeof result.workerIndex === 'number' ? result.workerIndex : null,
            started_at: started,
            finished_at: finished,
          };
          if (ex) {
            attemptId = ex.id;
            await db
              .updateTable('scenario_attempts')
              .set(values)
              .where('id', '=', attemptId)
              .execute();
          } else {
            attemptId = newId();
            await db
              .insertInto('scenario_attempts')
              .values({
                id: attemptId,
                scenario_id: scenarioId,
                run_id: ctx.runId,
                test_case_started_id: tcsId,
                created_at: nowIso(),
                ...values,
              })
              .execute();
            counts.attempts++;
          }

          // steps (category test.step, top level)
          const steps: any[] = (result.steps ?? []).filter(
            (s: any) => !s.category || s.category === 'test.step',
          );
          let idx = 0;
          for (const st of steps) {
            const testStepId = `${tcsId}-step-${idx}`;
            const stepStatus = st.error ? 'failed' : 'passed';
            const sv = {
              step_index: idx,
              kind: 'step',
              hook_type: null,
              keyword: null,
              text: String(st.title ?? ''),
              argument_json: null,
              status: stepStatus,
              duration_ms: typeof st.duration === 'number' ? st.duration : null,
              error_message: st.error?.message
                ? String(st.error.message).split('\n')[0]!.slice(0, 2000)
                : null,
              error_stack: st.error?.stack ?? null,
              definition_location: st.location ? `${st.location.file}:${st.location.line}` : null,
              pickle_step_id: null,
              layer_hint: 'ui' as const,
              started_at: null,
              finished_at: null,
            };
            const es = await db
              .selectFrom('steps')
              .select(['id'])
              .where('attempt_id', '=', attemptId)
              .where('test_step_id', '=', testStepId)
              .executeTakeFirst();
            if (es) await db.updateTable('steps').set(sv).where('id', '=', es.id).execute();
            else {
              await db
                .insertInto('steps')
                .values({
                  id: newId(),
                  attempt_id: attemptId,
                  scenario_id: scenarioId,
                  run_id: ctx.runId,
                  test_step_id: testStepId,
                  api_snapshot_json: null,
                  perf_json: null,
                  created_at: nowIso(),
                  ...sv,
                })
                .execute();
              counts.steps++;
            }
            idx++;
          }

          // attachments
          const dir = join(ctx.runDir, slug, fp, `r${retry}`);
          for (const att of result.attachments ?? []) {
            const name: string = att.name ?? 'attachment';
            const mediaType: string = att.contentType ?? 'application/octet-stream';
            const parsed = parseAttachmentName(name);
            const filePath = att.path
              ? isAbsolute(att.path)
                ? att.path
                : join(rootDir, att.path)
              : undefined;
            const bytes = att.body ? Buffer.from(att.body, 'base64') : null;
            if (!bytes && !(filePath && existsSync(filePath))) continue;
            const stored = storeFile(
              ctx.artifactsRoot,
              dir,
              targetFileFor(parsed, name, mediaType),
              bytes,
              filePath,
            );
            if (!stored) continue;
            const { kind, phase, stepIndex } = artifactKindFor(parsed, mediaType);
            const ea = await db
              .selectFrom('artifacts')
              .select(['id'])
              .where('rel_path', '=', stored.relPath)
              .executeTakeFirst();
            const av = {
              run_id: ctx.runId,
              scenario_id: scenarioId,
              attempt_id: attemptId,
              step_id: null,
              step_index: stepIndex,
              kind,
              phase,
              media_type: mediaType,
              file_name: name,
              size_bytes: stored.sizeBytes,
              sha256: stored.sha256,
              width: stored.width,
              height: stored.height,
              meta_json: enc.json({
                original: name,
                source: filePath ? relative(rootDir, filePath) : 'inline',
              }),
            };
            if (ea) await db.updateTable('artifacts').set(av).where('id', '=', ea.id).execute();
            else {
              await db
                .insertInto('artifacts')
                .values({ id: newId(), rel_path: stored.relPath, created_at: nowIso(), ...av })
                .execute();
              counts.artifacts++;
            }
          }
        }
      }
    }
  };
  for (const s of report.suites ?? []) await walk(s);
  return { ...counts, startedAt, finishedAt };
}
