import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { SdodsError } from '../errors.js';

/**
 * The axe audit itself, shared by the explicit accessibility steps (`steps/a11y.steps.ts`) and the
 * end-of-scenario audit every `@a11y` scenario gets (`quality/hooks.ts`).
 *
 * It lives outside the step file on purpose. A step file registers its phrases when it is imported,
 * and a project can switch a whole core library off with `steps.core.exclude: [a11y]` because its
 * own steps already use those phrases. If the tag hook imported the step file, it would register
 * those phrases again behind the project's back and bring back the collision it had excluded.
 */

/* ── axe result shapes ─────────────────────────────────────────────────── */

/**
 * Structural subset of axe-core's result types. Declared locally rather than imported from
 * `axe-core`: that package is a transitive dependency of `@axe-core/playwright`, not a direct
 * dependency of this one, so importing its types would couple the whole step library's
 * compilation to a package a consumer may not have installed.
 */
export interface A11yViolationNode {
  target: unknown[];
  html?: string;
  failureSummary?: string;
}

export interface A11yViolation {
  id: string;
  impact?: string | null;
  help?: string;
  helpUrl?: string;
  nodes: A11yViolationNode[];
}

export interface A11yResults {
  violations: A11yViolation[];
  passes: { id: string }[];
  incomplete: { id: string }[];
  inapplicable: { id: string }[];
  url?: string;
}

/** axe impact levels, weakest first. `impact: null` is treated as `minor`. */
export const IMPACT_ORDER = ['minor', 'moderate', 'serious', 'critical'] as const;

/**
 * WCAG 2.0/2.1/2.2 level A and AA, and deliberately nothing else. axe's `best-practice` tag set
 * changes between axe releases, so including it would let the same unchanged page pass one week
 * and fail the next — a step whose verdict moves on its own teaches teams to ignore it.
 */
export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/* ── pure judges ───────────────────────────────────────────────────────── */

/** Rank of an axe impact level; an absent impact ranks as `minor` rather than vanishing. */
export function impactRank(impact: string | null | undefined): number {
  const i = IMPACT_ORDER.indexOf((impact ?? 'minor') as (typeof IMPACT_ORDER)[number]);
  return i === -1 ? 0 : i;
}

/** Rejects an impact level the feature file invented, instead of silently matching nothing. */
export function parseImpactFloor(level: string): number {
  const i = IMPACT_ORDER.indexOf(level as (typeof IMPACT_ORDER)[number]);
  if (i === -1)
    throw new SdodsError('CONFIG_INVALID', `"${level}" is not an axe impact level.`, {
      hint: `Use one of: ${IMPACT_ORDER.join(', ')}.`,
    });
  return i;
}

export function violationsAtOrAbove(violations: A11yViolation[], floor: number): A11yViolation[] {
  return violations.filter((v) => impactRank(v.impact) >= floor);
}

/** Human-readable violation list: rule, impact, help text and the first few offending nodes. */
export function describeViolations(violations: A11yViolation[]): string {
  return violations
    .map((v) => {
      const nodes = v.nodes ?? [];
      const shown = nodes
        .slice(0, 3)
        .map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target)))
        .join(' | ');
      const more = nodes.length > 3 ? ` (+${nodes.length - 3} more node(s))` : '';
      return `${v.id} [${v.impact ?? 'minor'}] ${v.help ?? ''} → ${nodes.length} node(s): ${shown}${more}`;
    })
    .join('\n');
}

/**
 * PROVES the audit actually executed. axe reporting zero violations is indistinguishable from
 * axe never having run: a nonce'd CSP that blocks the injected source, an `about:blank` page, or
 * an `include` that matched nothing all produce an empty, green-looking result. If no rule landed
 * in passes, violations or incomplete, then nothing was examined and the verdict means nothing.
 */
export function assertAxeChecked(results: A11yResults, where: string): void {
  const checked =
    (results.passes?.length ?? 0) +
    (results.violations?.length ?? 0) +
    (results.incomplete?.length ?? 0);
  if (checked === 0)
    throw new SdodsError('RUN_FAILED', `axe examined nothing ${where}; the audit proves nothing.`, {
      hint: 'The page may be blank, the scoped selector may match an empty element, or a Content-Security-Policy may have blocked axe from running. Open the attached sdods/a11y JSON to see what axe reported.',
    });
}

/* ── axe plumbing ──────────────────────────────────────────────────────── */

export interface AxeRunOptions {
  include?: string | string[];
  exclude?: string[];
  tags?: string[];
  rules?: string[];
}

/**
 * Runs axe through `@axe-core/playwright`, which injects the source with `page.evaluate` rather
 * than `addScriptTag`. That matters: an app serving a nonce'd CSP blocks an injected `<script>`
 * silently, and the audit would report zero violations because it never ran.
 *
 * The import is lazy so a project that never audits does not need the dependency — a top-level
 * import would fail the load of every step file that reaches this module.
 */
export async function runAxe(page: Page, opts: AxeRunOptions): Promise<A11yResults> {
  let AxeBuilder: new (args: { page: Page }) => {
    include(selector: string): unknown;
    exclude(selector: string): unknown;
    withTags(tags: string[]): unknown;
    withRules(rules: string[]): unknown;
    analyze(): Promise<A11yResults>;
  };
  try {
    const mod = await import('@axe-core/playwright');
    // Named export first: the package exports the class as both `AxeBuilder` and `default`, and a
    // CJS interop path can hand `default` back as the namespace object rather than the class.
    AxeBuilder = (mod.AxeBuilder ?? mod.default) as never;
  } catch (cause) {
    throw new SdodsError('NOT_SUPPORTED', 'Accessibility audits need @axe-core/playwright.', {
      hint: 'Install it in the project that runs these steps: `npm i -D @axe-core/playwright`.',
      cause,
    });
  }
  const include = typeof opts.include === 'string' ? [opts.include] : (opts.include ?? []);
  const builder = new AxeBuilder({ page });
  for (const sel of include) builder.include(sel);
  for (const sel of opts.exclude ?? []) builder.exclude(sel);
  // withTags and withRules are mutually exclusive in axe-core; never set both.
  if (opts.rules) builder.withRules(opts.rules);
  else builder.withTags(opts.tags ?? WCAG_AA_TAGS);
  try {
    return await builder.analyze();
  } catch (cause) {
    // axe raises "unknown rule `x` in options.runOnly" for a rule id that does not exist, and
    // "No elements found for include in page Context" for a selector that matched nothing. Both
    // are defects in the step rather than in the page under test, so both are re-raised as such.
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/unknown rule/i.test(message))
      throw new SdodsError('CONFIG_INVALID', `axe rejected the rule id: ${message}`, {
        hint: 'Check the rule id against https://dequeuniversity.com/rules/axe.',
        cause,
      });
    if (/no elements found for include/i.test(message))
      throw new SdodsError('RUN_FAILED', `axe found nothing to scan: ${message}`, {
        hint: `The selector "${include.join(', ')}" matched no element by the time axe ran. Wait for the region to render first, or fix the selector.`,
        cause,
      });
    throw new SdodsError('RUN_FAILED', `axe failed to analyse the page: ${message}`, { cause });
  }
}

/** The file writer and attacher both audits use; the name and path are the caller's. */
export async function writeAndAttachJson(
  testInfo: { attach(name: string, opts: { path: string; contentType: string }): Promise<void> },
  name: string,
  file: string,
  body: unknown,
): Promise<void> {
  writeFileSync(file, JSON.stringify(body, null, 2));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

/* ── which URLs a scenario has already audited ─────────────────────────── */

/**
 * Whole-page audits an explicit step already ran in this scenario, by URL. The `@a11y` tag audit
 * skips a URL listed here: the author wrote the step, chose its threshold, and it has already passed
 * or failed. Scoped (`within …`) and single-rule audits are not recorded, because they did not look
 * at the whole page. Keyed on the per-test `scenario` object, so nothing leaks between tests.
 */
const audited = new WeakMap<object, Set<string>>();

export function markPageAudited(scenario: object, url: string): void {
  let set = audited.get(scenario);
  if (!set) audited.set(scenario, (set = new Set()));
  set.add(url);
}

export function wasPageAudited(scenario: object, url: string): boolean {
  return audited.get(scenario)?.has(url) ?? false;
}
