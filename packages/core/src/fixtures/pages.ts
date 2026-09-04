import type { Page } from '@playwright/test';
import type { ResolvedConfig } from '../config/resolve.js';
import type { Healer } from '../heal/healer.js';
import type { BasePage } from '../pages/base-page.js';

type PageCtor<T extends BasePage> = new (
  page: Page,
  config: ResolvedConfig,
  heal: Healer,
  vars?: () => Record<string, unknown>,
) => T;

/** Lazily constructs page objects with the scenario's page/config/healer; one instance per class per scenario. */
export class PageRegistry {
  private readonly instances = new Map<PageCtor<BasePage>, BasePage>();

  constructor(
    readonly page: Page,
    readonly config: ResolvedConfig,
    readonly heal: Healer,
    readonly vars: () => Record<string, unknown> = () => ({}),
  ) {}

  get<T extends BasePage>(ctor: PageCtor<T>): T {
    let inst = this.instances.get(ctor as PageCtor<BasePage>);
    if (!inst) {
      inst = new ctor(this.page, this.config, this.heal, this.vars);
      this.instances.set(ctor as PageCtor<BasePage>, inst);
    }
    return inst as T;
  }
}
