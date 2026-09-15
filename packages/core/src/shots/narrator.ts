import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  attachmentNames,
  scenarioFiles,
  type ScenarioShotPhase,
  type StepShotPhase,
  type VisualFailure,
} from '@sdods/contracts';
import { Logger } from '../logger.js';
import type { ScenarioMeta } from '../fixtures/scenario.js';
import type { ShotPolicyResolved } from './policy.js';
import { baselineKey, parseVisualError, pngSize, visualCheckOptions } from './baselines.js';

export interface NarratorDeps {
  page: Page;
  policy: ShotPolicyResolved;
  scenario: ScenarioMeta;
  testInfo: TestInfo;
  /** returns true when the step made only API calls and the page URL is unchanged */
  skipStep?: (stepIndex: number) => boolean;
}

/** Takes the before/after/scenario screenshots dictated by the policy and attaches them with shared names. */
export class ScreenshotNarrator {
  private readonly log = new Logger('shots');
  private lastUrl = '';
  readonly taken: string[] = [];

  constructor(private readonly deps: NarratorDeps) {}

  get policy() {
    return this.deps.policy;
  }

  private async capture(file: string, name: string): Promise<string | undefined> {
    const { page, policy, testInfo } = this.deps;
    if (page.isClosed()) return undefined;
    try {
      await page.screenshot({
        path: file,
        fullPage: policy.fullPage,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        mask: policy.mask.map((sel) => page.locator(sel)),
        timeout: 5_000,
      });
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
      this.taken.push(file);
      return file;
    } catch (e) {
      this.log.debug(`screenshot skipped (${name}): ${(e as Error).message}`);
      return undefined;
    }
  }

  async scenarioStart() {
    if (!this.deps.policy.scenario) return;
    await this.scenarioShot('start');
  }

  async scenarioEnd() {
    if (!this.deps.policy.scenario) return;
    await this.scenarioShot('end');
  }

  async failure() {
    if (this.deps.policy.mode === 'off') return;
    await this.scenarioShot('failure');
  }

  private scenarioShot(phase: ScenarioShotPhase) {
    return this.capture(
      this.deps.scenario.file(scenarioFiles.scenarioShot(phase)),
      attachmentNames.shotScenario(phase),
    );
  }

  async beforeStep(stepIndex: number, _title?: string) {
    if (!this.deps.policy.step) return;
    this.lastUrl = safeUrl(this.deps.page);
    await this.stepShot(stepIndex, 'before');
  }

  async afterStep(stepIndex: number, _title?: string) {
    if (!this.deps.policy.step) return;
    if (this.deps.skipStep?.(stepIndex) && safeUrl(this.deps.page) === this.lastUrl) return;
    await this.stepShot(stepIndex, 'after');
  }

  private stepShot(stepIndex: number, phase: StepShotPhase) {
    return this.capture(
      this.deps.scenario.file(scenarioFiles.stepShot(stepIndex, phase)),
      attachmentNames.shotStep(stepIndex, phase),
    );
  }

  /**
   * Visual baseline check (`@visual`): `expect(page).toHaveScreenshot(name)` with the merged mask
   * and threshold (see {@link visualCheckOptions}). A failure leaves a {@link VisualFailure} record
   * and copies of the images in the scenario directory for `sdods baselines` to review and accept.
   */
  async visual(name: string, stepIndex: number, extraMask: readonly string[] = []) {
    const { page, policy, testInfo } = this.deps;
    const fileName = name.endsWith('.png') ? name : `${name}.png`;
    const opts = visualCheckOptions(fileName, policy, extraMask);
    try {
      await expect(page).toHaveScreenshot(fileName, {
        fullPage: policy.fullPage,
        animations: 'disabled',
        caret: 'hide',
        mask: opts.mask.map((sel) => page.locator(sel)),
        maxDiffPixelRatio: opts.maxDiffPixelRatio,
      });
    } catch (e) {
      this.recordVisualFailure(fileName, stepIndex, opts.maxDiffPixelRatio, e);
      throw e;
    }
    this.recordVisualPass(fileName);
    const snapshot = testInfo.snapshotPath(fileName);
    if (existsSync(snapshot))
      await testInfo.attach(attachmentNames.visual(stepIndex, name), {
        path: snapshot,
        contentType: 'image/png',
      });
  }

  private visualIdentity(fileName: string) {
    const { scenario, testInfo } = this.deps;
    return {
      name: baselineKey(fileName),
      runnerProject: testInfo.project.name,
      fingerprint: scenario.fingerprint,
      retry: testInfo.retry,
    };
  }

  private recordVisualPass(fileName: string) {
    const id = this.visualIdentity(fileName);
    try {
      writeFileSync(
        this.deps.scenario.file(scenarioFiles.visualPassed(id.runnerProject, id.name)),
        JSON.stringify({ ...id, recordedAt: new Date().toISOString() }),
      );
    } catch (err) {
      this.log.debug(`visual pass marker skipped: ${(err as Error).message}`);
    }
  }

  /** Never throws: the check's own error is what the scenario reports. */
  private recordVisualFailure(
    fileName: string,
    stepIndex: number,
    maxDiffPixelRatio: number,
    error: unknown,
  ) {
    const { scenario, testInfo } = this.deps;
    try {
      const id = this.visualIdentity(fileName);
      const base = fileName.replace(/\.png$/i, '');
      // Playwright attaches `<name>-actual.png` etc. and writes them to the test's output dir.
      const source = (phase: 'actual' | 'expected' | 'diff') => {
        const att = testInfo.attachments.find((a) => a.name === `${base}-${phase}.png`)?.path;
        const p = att ?? testInfo.outputPath(`${base}-${phase}.png`);
        return existsSync(p) ? p : undefined;
      };
      const copies: Partial<Record<'actual' | 'expected' | 'diff', string>> = {};
      for (const phase of ['actual', 'expected', 'diff'] as const) {
        const src = source(phase);
        if (!src) continue;
        const dest = scenario.file(scenarioFiles.visualImage(id.runnerProject, id.name, phase));
        copyFileSync(src, dest);
        copies[phase] = relative(scenario.runDir, dest).split('\\').join('/');
      }
      // No actual image means the page could not be captured at all: nothing to accept.
      if (!copies.actual) return;
      const parsed = parseVisualError((error as Error)?.message ?? String(error));
      const size = pngSize(
        scenario.file(scenarioFiles.visualImage(id.runnerProject, id.name, 'actual')),
      );
      const record: VisualFailure = {
        ...id,
        snapshot: fileName,
        project: scenario.data.project,
        platform: process.platform,
        scenarioName: scenario.data.scenarioName,
        featureUri: scenario.data.featureUri,
        stepIndex,
        reason: parsed.reason,
        baseline: relative(scenario.projectRoot, testInfo.snapshotPath(fileName))
          .split('\\')
          .join('/'),
        actual: copies.actual,
        expected: copies.expected,
        diff: copies.diff,
        diffPixels: parsed.diffPixels,
        diffRatio:
          parsed.diffPixels !== undefined && size
            ? parsed.diffPixels / (size.width * size.height)
            : undefined,
        maxDiffPixelRatio,
        recordedAt: new Date().toISOString(),
      };
      writeFileSync(
        scenario.file(scenarioFiles.visualFailure(id.runnerProject, id.name)),
        JSON.stringify(record, null, 2),
      );
    } catch (err) {
      this.log.debug(`visual failure record skipped: ${(err as Error).message}`);
    }
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
