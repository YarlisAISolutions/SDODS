import { writeFileSync } from 'node:fs';
import { expect, type Locator, type TestInfo } from '@playwright/test';
import { attachmentNames, scenarioFiles, type HealConfig, type HealEvent } from '@sdods/contracts';
import { Logger } from '../logger.js';
import { SdodsError } from '../errors.js';
import type { ScenarioMeta } from '../fixtures/scenario.js';
import { buildCandidates } from './strategies.js';
import type { HealAction, HealContext, HealProbe } from './types.js';
import type { HealHistory } from './history.js';

export interface HealerDeps {
  config: HealConfig;
  history?: HealHistory;
  scenario?: ScenarioMeta;
  testInfo?: TestInfo;
  stepIndex?: () => number;
  runId?: string;
}

/** Locator wrapper: every action goes through the healer. */
export class HealedLocator {
  constructor(
    private readonly healer: Healer,
    readonly primary: Locator,
    readonly ctx: HealContext,
  ) {}

  get raw(): Locator {
    return this.primary;
  }
  resolve(action: HealAction = 'assert') {
    return this.healer.resolve(this.primary, this.ctx, action);
  }
  async click(opts?: Parameters<Locator['click']>[0]) {
    await (await this.resolve('click')).click(opts);
  }
  async fill(value: string, opts?: Parameters<Locator['fill']>[1]) {
    await (await this.resolve('fill')).fill(value, opts);
  }
  async selectOption(value: string | { label?: string; value?: string }) {
    await (
      await this.resolve('select')
    ).selectOption(typeof value === 'string' ? { label: value } : value);
  }
  async hover() {
    await (await this.resolve('hover')).hover();
  }
  async check() {
    await (await this.resolve('check')).check();
  }
  async uncheck() {
    await (await this.resolve('check')).uncheck();
  }
  async textContent() {
    return (await this.resolve('assert')).textContent();
  }
  async innerText() {
    return (await this.resolve('assert')).innerText();
  }
  async isVisible() {
    return this.primary.isVisible();
  }
  async expectVisible() {
    await expect(await this.resolve('assert')).toBeVisible();
  }
  async expectHidden() {
    // negative assertions are never healed
    await expect(this.primary).toBeHidden();
  }
  async expectText(text: string | RegExp) {
    await expect(await this.resolve('assert')).toContainText(text);
  }
}

export class Healer {
  private readonly log = new Logger('heal');
  readonly events: HealEvent[] = [];

  constructor(private readonly deps: HealerDeps) {}

  locator(primary: Locator, ctx: HealContext): HealedLocator {
    return new HealedLocator(this, primary, ctx);
  }

  async click(primary: Locator, ctx: HealContext, opts?: Parameters<Locator['click']>[0]) {
    await (await this.resolve(primary, ctx, 'click')).click(opts);
  }
  async fill(primary: Locator, ctx: HealContext, value: string) {
    await (await this.resolve(primary, ctx, 'fill')).fill(value);
  }
  async select(primary: Locator, ctx: HealContext, value: string) {
    await (await this.resolve(primary, ctx, 'select')).selectOption({ label: value });
  }
  async expectVisible(primary: Locator, ctx: HealContext) {
    await expect(await this.resolve(primary, ctx, 'assert')).toBeVisible();
  }
  async expectText(primary: Locator, ctx: HealContext, text: string | RegExp) {
    await expect(await this.resolve(primary, ctx, 'assert')).toContainText(text);
  }

  /**
   * Wait briefly for the primary locator; on failure probe all candidates in parallel,
   * score them and pick the best above minScore. Records a HealEvent either way.
   */
  async resolve(primary: Locator, ctx: HealContext, action: HealAction): Promise<Locator> {
    const cfg = this.deps.config;
    try {
      await primary.first().waitFor({ state: 'visible', timeout: cfg.primaryTimeoutMs });
      return primary;
    } catch (primaryError) {
      if (!cfg.enabled || !cfg.actions.includes(action)) throw primaryError;
      const page = primary.page();
      const t0 = Date.now();
      const candidates = buildCandidates(page, ctx);
      if (candidates.length === 0) throw primaryError;

      const probes = await Promise.all(
        candidates.map((c) => this.probe(c, cfg.probeTimeoutMs, action)),
      );
      const ranked = probes.sort((a, b) => b.score - a.score);
      const best = ranked[0];
      const event: HealEvent = {
        fingerprint: this.deps.scenario?.fingerprint ?? '',
        runId: this.deps.runId ?? '',
        stepIndex: this.deps.stepIndex?.() ?? 0,
        action,
        description: ctx.description,
        pageUrl: page.url(),
        originalSelector: String(primary),
        context: { ...ctx, name: ctx.name instanceof RegExp ? ctx.name.toString() : ctx.name },
        strategyUsed: best && best.score >= cfg.minScore ? best.strategy : null,
        healedSelector: best && best.score >= cfg.minScore ? best.selector : null,
        candidates: ranked.map(({ locator: _l, baseScore: _b, ...rest }) => rest),
        succeeded: Boolean(best && best.score >= cfg.minScore),
        durationMs: Date.now() - t0,
        at: new Date().toISOString(),
      };
      this.record(event);
      if (!event.succeeded || !best) {
        throw new SdodsError(
          'HEAL_FAILED',
          `Could not locate "${ctx.description}" (${String(primary)}) and no healing candidate scored ≥ ${cfg.minScore}.`,
          {
            hint: `Probed: ${ranked.map((p) => `${p.strategy}=${p.score.toFixed(2)}`).join(', ') || 'none'}. Add role/name/testId/label to the heal context or fix the locator.`,
            details: { candidates: event.candidates },
            cause: primaryError,
          },
        );
      }
      this.log.warn(
        `healed "${ctx.description}": ${String(primary)} → ${best.selector} via ${best.strategy} (score ${best.score.toFixed(2)}, ${event.durationMs} ms). Update the page object.`,
      );
      return best.locator.first();
    }
  }

  private async probe(
    c: ReturnType<typeof buildCandidates>[number],
    timeoutMs: number,
    action: HealAction,
  ): Promise<HealProbe> {
    const t0 = Date.now();
    const deadline = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe timeout')), timeoutMs),
    );
    try {
      const count = await Promise.race([c.locator.count(), deadline]);
      const first = c.locator.first();
      const visible = count > 0 ? await Promise.race([first.isVisible(), deadline]) : false;
      const enabled = visible
        ? await Promise.race([first.isEnabled().catch(() => true), deadline])
        : false;
      const uniqueness = count === 1 ? 1 : count === 0 ? 0 : 0.6;
      const vis = visible ? 1 : 0.2;
      const en = enabled || action === 'assert' ? 1 : 0.5;
      const bonus = this.deps.history?.bonus(c.strategy, c.selector) ?? 0;
      const score = count === 0 ? 0 : Math.min(1, c.baseScore * uniqueness * vis * en + bonus);
      return { ...c, count, visible, enabled, score, ms: Date.now() - t0 };
    } catch {
      return { ...c, count: 0, visible: false, enabled: false, score: 0, ms: Date.now() - t0 };
    }
  }

  private record(event: HealEvent) {
    this.events.push(event);
    this.deps.history?.record(event);
    const { scenario, testInfo } = this.deps;
    if (!scenario) return;
    try {
      scenario.appendJsonl(scenarioFiles.healLog, event);
      if (testInfo) {
        const n = this.events.length;
        const file = scenario.file(`heal/${String(event.stepIndex).padStart(2, '0')}-${n}.json`);
        writeFileSync(file, JSON.stringify(event, null, 2));
        void testInfo.attach(attachmentNames.heal(event.stepIndex, n), {
          path: file,
          contentType: 'application/json',
        });
        testInfo.annotations.push({
          type: 'sdods:heal',
          description: `${event.description}: ${event.originalSelector} → ${event.healedSelector ?? 'FAILED'}`,
        });
      }
    } catch (e) {
      this.log.debug(`could not record heal event: ${(e as Error).message}`);
    }
  }
}
