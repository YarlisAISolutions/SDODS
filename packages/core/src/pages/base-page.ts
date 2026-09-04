import type { Download, Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';
import { AutomaxError } from '../errors.js';
import type { Healer, HealedLocator } from '../heal/healer.js';
import type { HealContext } from '../heal/types.js';
import { Logger } from '../logger.js';
import { render as renderTemplate } from '../api/template.js';

/**
 * Base for page objects. Route-aware navigation, heal-aware interactions, common helpers.
 * Subclasses declare locators with `this.heal.locator(primary, context)` and playwright-bdd decorators.
 */
export class BasePage {
  protected readonly log: Logger;

  constructor(
    readonly page: Page,
    readonly config: ResolvedConfig,
    readonly heal: Healer,
    private readonly varsGetter: () => Record<string, unknown> = () => ({}),
  ) {
    this.log = new Logger(this.constructor.name);
  }

  /** Scenario variables (dataset rows, saved API values) merged over env vars. */
  get vars(): Record<string, unknown> {
    return { ...(this.config.env.vars as Record<string, unknown>), ...this.varsGetter() };
  }

  /** Render `{{name}}` placeholders from scenario + env variables. */
  render(text: string): string {
    return renderTemplate(text, this.vars);
  }

  /** Path for a named route from automax.project.yaml, or the raw path when not a route name. */
  routePath(nameOrPath: string): string {
    const routes = this.config.project.routes;
    if (nameOrPath in routes) return routes[nameOrPath]!;
    if (nameOrPath.startsWith('/') || /^https?:\/\//.test(nameOrPath)) return nameOrPath;
    throw new AutomaxError(
      'CONFIG_INVALID',
      `Unknown route "${nameOrPath}" for project ${this.config.project.slug}.`,
      {
        hint: `Known routes: ${Object.keys(routes).join(', ') || '(none)'}. Add it under routes: in automax.project.yaml or pass a path starting with "/".`,
      },
    );
  }

  async goto(nameOrPath: string, opts?: Parameters<Page['goto']>[1]) {
    const path = this.routePath(nameOrPath);
    this.log.step(`navigate → ${path}`);
    await this.page.goto(path, { waitUntil: 'domcontentloaded', ...opts });
  }

  h(primary: Locator, ctx: HealContext): HealedLocator {
    return this.heal.locator(primary, ctx);
  }

  async click(target: Locator | HealedLocator, ctx?: HealContext) {
    if ('primary' in target) return target.click();
    if (ctx) return this.heal.click(target, ctx);
    await target.click();
  }

  async fill(target: Locator | HealedLocator, value: string, ctx?: HealContext) {
    if ('primary' in target) return target.fill(value);
    if (ctx) return this.heal.fill(target, ctx, value);
    await target.fill(value);
  }

  async selectOption(target: Locator | HealedLocator, label: string, ctx?: HealContext) {
    if ('primary' in target) return target.selectOption(label);
    if (ctx) return this.heal.select(target, ctx, label);
    await target.selectOption({ label });
  }

  async expectVisible(target: Locator | HealedLocator, ctx?: HealContext) {
    if ('primary' in target) return target.expectVisible();
    if (ctx) return this.heal.expectVisible(target, ctx);
    await expect(target).toBeVisible();
  }

  async expectUrlContains(part: string) {
    await expect(this.page).toHaveURL(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  pageTitle(): Promise<string> {
    return this.page.title();
  }

  /** Wait for a popup opened by `action` and return it. */
  async waitForPopup(action: () => Promise<void>): Promise<Page> {
    const [popup] = await Promise.all([this.page.waitForEvent('popup'), action()]);
    return popup;
  }

  frame(nameOrSelector: string) {
    return this.page.frameLocator(nameOrSelector);
  }

  async upload(target: Locator, files: string | string[]) {
    await target.setInputFiles(files);
  }

  async waitForDownload(action: () => Promise<void>): Promise<Download> {
    const [download] = await Promise.all([this.page.waitForEvent('download'), action()]);
    return download;
  }
}
