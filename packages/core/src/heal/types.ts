import type { Locator, Page } from '@playwright/test';
import type { HealCandidate, HealEvent } from '@sdods/contracts';

export type AriaRole = Parameters<Page['getByRole']>[0];

export interface HealContext {
  /** Human description, used in logs and heal history keys. */
  description: string;
  role?: AriaRole;
  name?: string | RegExp;
  testId?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  title?: string;
  altText?: string;
  css?: string[];
}

export type HealAction = HealEvent['action'];

export interface HealProbe extends HealCandidate {
  locator: Locator;
  baseScore: number;
}

export interface HealHistoryEntry {
  description: string;
  successes: number;
  failures: number;
  lastStrategy?: string;
  lastSelector?: string;
}
