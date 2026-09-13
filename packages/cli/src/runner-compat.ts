import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The oldest Playwright whose step locations playwright-bdd can match in a workspace that installs
 * SDODS from npm.
 *
 * playwright-bdd attributes a result to a Gherkin step by comparing each `test.step` location with
 * the line bddgen wrote for it. Below 1.63, Playwright reports those locations against its own
 * transformed copy of the generated spec instead of the source-mapped line, so no step matches:
 * messages.ndjson (and the cucumber HTML report, and anything reading either) records every step
 * SKIPPED, and a failure lands on a hook. Measured on 1.60.0, 1.61.1, 1.62.0 and 1.62.1 against
 * 1.63.0, with the published @sdods packages and playwright-bdd 9.2.x (#79). A run from this
 * monorepo's sources does not show it, so only this check stands between a pinned workspace and a
 * report that names no failing step.
 */
export const MIN_PLAYWRIGHT_FOR_STEP_RESULTS = '1.63.0';

/** The `@playwright/test` version a workspace resolves, or undefined when it is not installed. */
export function installedPlaywrightVersion(rootDir: string): string | undefined {
  try {
    const require = createRequire(join(rootDir, 'package.json'));
    return (require('@playwright/test/package.json') as { version: string }).version;
  } catch {
    return undefined;
  }
}

function below(version: string, floor: string): boolean {
  const parse = (v: string) => v.split('-')[0]!.split('.').map((n) => Number(n) || 0);
  const [a, b] = [parse(version), parse(floor)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/** A warning when `version` records every step SKIPPED, else undefined. */
export function stepResultsWarning(version: string | undefined): string | undefined {
  if (!version || !below(version, MIN_PLAYWRIGHT_FOR_STEP_RESULTS)) return undefined;
  return (
    `@playwright/test ${version} is older than ${MIN_PLAYWRIGHT_FOR_STEP_RESULTS}: messages.ndjson and the ` +
    `cucumber report will record every step SKIPPED and attach failures to a hook. ` +
    `Upgrade: npm i -D @playwright/test@^${MIN_PLAYWRIGHT_FOR_STEP_RESULTS}`
  );
}
