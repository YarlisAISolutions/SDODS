import { existsSync } from 'node:fs';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  attachmentNames,
  scenarioFiles,
  type ScenarioShotPhase,
  type StepShotPhase,
} from '@automax/contracts';
import { Logger } from '../logger.js';
import type { ScenarioMeta } from '../fixtures/scenario.js';
import type { ShotPolicyResolved } from './policy.js';

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

  /** Visual baseline check (`@visual`): `expect(page).toHaveScreenshot(name)`. */
  async visual(name: string, stepIndex: number) {
    const { page, policy, testInfo } = this.deps;
    const fileName = name.endsWith('.png') ? name : `${name}.png`;
    await expect(page).toHaveScreenshot(fileName, {
      fullPage: policy.fullPage,
      animations: 'disabled',
      caret: 'hide',
      mask: policy.mask.map((sel) => page.locator(sel)),
      maxDiffPixelRatio: 0.01,
    });
    const snapshot = testInfo.snapshotPath(fileName);
    if (existsSync(snapshot))
      await testInfo.attach(attachmentNames.visual(stepIndex, name), {
        path: snapshot,
        contentType: 'image/png',
      });
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}
