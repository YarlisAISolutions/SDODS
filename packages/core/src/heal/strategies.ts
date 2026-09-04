import type { Page } from '@playwright/test';
import type { HealContext, HealProbe } from './types.js';

/** Build candidate locators from the context, ordered by base score (higher = more semantic). */
export function buildCandidates(
  page: Page,
  ctx: HealContext,
): Omit<HealProbe, 'score' | 'count' | 'visible' | 'enabled' | 'ms'>[] {
  const out: Omit<HealProbe, 'score' | 'count' | 'visible' | 'enabled' | 'ms'>[] = [];
  if (ctx.role) {
    const name = ctx.name;
    out.push({
      strategy: 'role',
      selector: `getByRole('${ctx.role}'${name ? `, { name: ${name instanceof RegExp ? name.toString() : `'${name}'`} }` : ''})`,
      locator: name ? page.getByRole(ctx.role, { name }) : page.getByRole(ctx.role),
      baseScore: 1.0,
    });
  }
  if (ctx.testId) {
    out.push({
      strategy: 'testid',
      selector: `getByTestId('${ctx.testId}')`,
      locator: page.getByTestId(ctx.testId),
      baseScore: 0.95,
    });
  }
  if (ctx.label) {
    out.push({
      strategy: 'label',
      selector: `getByLabel('${ctx.label}')`,
      locator: page.getByLabel(ctx.label),
      baseScore: 0.9,
    });
  }
  if (ctx.placeholder) {
    out.push({
      strategy: 'placeholder',
      selector: `getByPlaceholder('${ctx.placeholder}')`,
      locator: page.getByPlaceholder(ctx.placeholder),
      baseScore: 0.8,
    });
  }
  if (ctx.title) {
    out.push({
      strategy: 'title',
      selector: `getByTitle('${ctx.title}')`,
      locator: page.getByTitle(ctx.title),
      baseScore: 0.75,
    });
  }
  if (ctx.altText) {
    out.push({
      strategy: 'alt',
      selector: `getByAltText('${ctx.altText}')`,
      locator: page.getByAltText(ctx.altText),
      baseScore: 0.75,
    });
  }
  const text = ctx.text ?? (typeof ctx.name === 'string' ? ctx.name : undefined);
  if (text) {
    out.push({
      strategy: 'text-exact',
      selector: `getByText('${text}', { exact: true })`,
      locator: page.getByText(text, { exact: true }),
      baseScore: 0.7,
    });
    out.push({
      strategy: 'text-partial',
      selector: `getByText('${text}')`,
      locator: page.getByText(text),
      baseScore: 0.5,
    });
  }
  for (const css of ctx.css ?? []) {
    out.push({
      strategy: 'css',
      selector: `locator('${css}')`,
      locator: page.locator(css),
      baseScore: 0.4,
    });
  }
  return out;
}
