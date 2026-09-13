import type { Locator, Page } from '@playwright/test';
import type { AriaRole, HealAction, HealContext, HealProbe } from './types.js';

/**
 * The roles an element must have for an action to make sense on it. `assert` and `hover` apply to
 * anything, so they have none. A contenteditable editor has no role at all, which is why callers
 * treat a role filter as a preference, never as the only way to reach an element.
 */
const ACTION_ROLES: Record<HealAction, AriaRole[]> = {
  fill: ['textbox', 'searchbox', 'combobox', 'spinbutton'],
  select: ['combobox', 'listbox'],
  check: ['checkbox', 'radio', 'switch'],
  click: ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch'],
  assert: [],
  hover: [],
};

export function rolesFor(action: HealAction): AriaRole[] {
  return ACTION_ROLES[action];
}

/** `locator` narrowed to elements whose role fits `action`; `locator` itself when none is defined. */
export function withActionRole(page: Page, locator: Locator, action: HealAction): Locator {
  const roles = rolesFor(action);
  if (roles.length === 0) return locator;
  return locator.and(roles.map((r) => page.getByRole(r)).reduce((union, next) => union.or(next)));
}

/**
 * Candidates for a primary locator that matched several elements: the primary narrowed to the
 * roles that fit the action (and the context's own role, when it names one), as a single union.
 * A union keeps a genuine tie ambiguous — an input and a select both labelled "Country" still
 * count 2 for a fill — rather than letting role order break it silently.
 */
export function disambiguationCandidates(
  page: Page,
  primary: Locator,
  ctx: HealContext,
  action: HealAction,
): Omit<HealProbe, 'score' | 'count' | 'visible' | 'enabled' | 'ms'>[] {
  const roles = [...new Set([...(ctx.role ? [ctx.role] : []), ...rolesFor(action)])];
  if (roles.length === 0) return [];
  return [
    {
      strategy: 'role-filter',
      selector: `${String(primary)}.and(${roles.map((r) => `getByRole('${r}')`).join('.or(')}${')'.repeat(roles.length - 1)})`,
      locator: primary.and(
        roles.map((r) => page.getByRole(r)).reduce((union, next) => union.or(next)),
      ),
      baseScore: 1.0,
    },
  ];
}

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
