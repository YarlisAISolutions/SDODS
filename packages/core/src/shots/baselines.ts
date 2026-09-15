import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { VisualFailure } from '@sdods/contracts';
import { SdodsError } from '../errors.js';
import type { ShotPolicyResolved } from './policy.js';

/** Where a project's baselines live; accept refuses to write anywhere else. */
export const BASELINES_DIR = join('features', '__screenshots__');

/** Baseline name as the config keys it: the step argument without `.png`. */
export function baselineKey(name: string): string {
  return name.replace(/\.png$/i, '');
}

/**
 * Mask and threshold for one baseline check: the project/env `screenshots.mask`, plus
 * `screenshots.baselines.<name>.mask`, plus the selectors the step passed. Duplicates are dropped.
 * The threshold is the baseline's own `maxDiffPixelRatio`, else the project/env one.
 */
export function visualCheckOptions(
  name: string,
  policy: Pick<ShotPolicyResolved, 'mask' | 'maxDiffPixelRatio' | 'baselines'>,
  extraMask: readonly string[] = [],
): { mask: string[]; maxDiffPixelRatio: number } {
  const own = policy.baselines?.[baselineKey(name)];
  const mask = [...new Set([...policy.mask, ...(own?.mask ?? []), ...extraMask])].filter(
    (s) => s.trim() !== '',
  );
  return { mask, maxDiffPixelRatio: own?.maxDiffPixelRatio ?? policy.maxDiffPixelRatio ?? 0.01 };
}

/**
 * Selectors from the `masking {string}` step argument. Comma-separated, so
 * `"[data-test=badge], .timestamp"` masks both. A selector that itself contains a comma
 * (`:is(a, b)`, `[title="a, b"]`) belongs in `screenshots.baselines.<name>.mask` instead.
 */
export function parseMaskArgument(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ANSI colour sequences, built by code point so the source carries no control character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** What Playwright's `toHaveScreenshot` error says about why the check failed. */
export function parseVisualError(message: string): {
  reason: VisualFailure['reason'];
  diffPixels?: number;
} {
  const plain = message.replace(ANSI, '');
  if (/snapshot doesn't exist|writing actual/i.test(plain)) return { reason: 'missing' };
  if (/Expected an image \d+px by \d+px, received/i.test(plain)) return { reason: 'size' };
  const px = /(\d+) pixels \(ratio [\d.]+ of all image pixels\) are different/.exec(plain);
  return { reason: 'changed', diffPixels: px ? Number(px[1]) : undefined };
}

/** Width and height from a PNG header, without decoding it. */
export function pngSize(file: string): { width: number; height: number } | undefined {
  try {
    const buf = readFileSync(file);
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return undefined;
  }
}

/**
 * The visual checks that failed in a run and still need a decision: every
 * `visual/<target>/<name>.failure.json` under the run's scenario directories, keeping only the
 * last attempt of each check. A check that passed on a later retry is not listed.
 */
export function listVisualFailures(runDir: string): VisualFailure[] {
  if (!existsSync(runDir)) return [];
  const latest = new Map<string, { retry: number; failure?: VisualFailure }>();
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const abs = join(dir, n);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        // Runner scratch and reports never hold records.
        if (
          depth === 0 &&
          /^(runner-output|pw-output|html-report|shard-reports|blob-report)$/.test(n)
        )
          continue;
        walk(abs, depth + 1);
        continue;
      }
      const m = /^(.*)\.(failure|passed)\.json$/.exec(n);
      if (!m || !abs.split(sep).includes('visual')) continue;
      let rec: VisualFailure;
      try {
        rec = JSON.parse(readFileSync(abs, 'utf8')) as VisualFailure;
      } catch {
        continue;
      }
      if (!rec || typeof rec.name !== 'string' || typeof rec.runnerProject !== 'string') continue;
      const key = JSON.stringify([rec.fingerprint, rec.runnerProject, rec.name]);
      const prev = latest.get(key);
      const retry = Number(rec.retry ?? 0);
      if (prev && prev.retry > retry) continue;
      if (prev && prev.retry === retry && m[2] === 'passed') continue;
      latest.set(key, { retry, failure: m[2] === 'failure' ? rec : undefined });
    }
  };
  walk(runDir, 0);
  return [...latest.values()]
    .map((v) => v.failure)
    .filter((f): f is VisualFailure => !!f)
    .sort(
      (a, b) =>
        a.project.localeCompare(b.project) ||
        a.runnerProject.localeCompare(b.runnerProject) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * Pick failures by name. A name matches `inventory`, `inventory.png`, or
 * `<run target>/inventory` to narrow it to one browser.
 */
export function selectVisualFailures(
  failures: readonly VisualFailure[],
  sel: { names?: readonly string[]; all?: boolean },
): VisualFailure[] {
  if (sel.all) return [...failures];
  const names = sel.names ?? [];
  if (!names.length)
    throw new SdodsError('CONFIG_INVALID', 'Name the baselines to accept, or pass --all.', {
      exitCode: 2,
    });
  const picked: VisualFailure[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const slash = raw.lastIndexOf('/');
    const target = slash > 0 ? raw.slice(0, slash) : undefined;
    const key = baselineKey(slash > 0 ? raw.slice(slash + 1) : raw);
    const hits = failures.filter(
      (f) => baselineKey(f.name) === key && (!target || f.runnerProject === target),
    );
    if (!hits.length) unknown.push(raw);
    for (const h of hits) if (!picked.includes(h)) picked.push(h);
  }
  if (unknown.length) {
    const available = [...new Set(failures.map((f) => `${f.runnerProject}/${f.name}`))];
    throw new SdodsError(
      'CONFIG_INVALID',
      `No failed visual check named ${unknown.map((u) => `"${u}"`).join(', ')} in this run.`,
      {
        hint: available.length
          ? `Failed in this run: ${available.join(', ')}`
          : 'No visual check failed in this run.',
        exitCode: 2,
      },
    );
  }
  return picked;
}

export interface AcceptedBaseline {
  name: string;
  project: string;
  runnerProject: string;
  platform: string;
  reason: VisualFailure['reason'];
  diffRatio?: number;
  /** image copied, absolute */
  from: string;
  /** baseline written, absolute */
  to: string;
  /** false when a baseline existed and was replaced */
  created: boolean;
  /** the diff image a person reviewed, absolute, when there was one */
  diff?: string;
}

/**
 * Copy each failure's actual image over its baseline: `features/__screenshots__/<run
 * target>/<platform>/<name>.png` of the project, for the platform the run happened on. Writes
 * into the project tree the way `--update-snapshots` does, so a person runs it, not an agent.
 */
export function acceptVisualFailures(opts: {
  runDir: string;
  failures: readonly VisualFailure[];
  projectRoot: (slug: string) => string;
}): AcceptedBaseline[] {
  const plan = opts.failures.map((f) => {
    const root = resolve(opts.projectRoot(f.project));
    const guard = resolve(root, BASELINES_DIR);
    const to = resolve(root, f.baseline);
    const inside = relative(guard, to);
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || !/\.png$/i.test(to))
      throw new SdodsError(
        'CONFIG_INVALID',
        `Refusing to write ${f.baseline}: baselines live under ${BASELINES_DIR}/.`,
        { exitCode: 2 },
      );
    const runDir = resolve(opts.runDir);
    const from = resolve(runDir, f.actual);
    const back = relative(runDir, from);
    if (back.startsWith('..') || isAbsolute(back))
      throw new SdodsError('CONFIG_INVALID', `Actual image ${f.actual} is outside the run.`, {
        exitCode: 2,
      });
    if (!existsSync(from))
      throw new SdodsError(
        'CONFIG_NOT_FOUND',
        `The actual image for ${f.runnerProject}/${f.name} is missing: ${from}`,
        { exitCode: 2 },
      );
    const diff = f.diff ? resolve(runDir, f.diff) : undefined;
    return { f, from, to, diff: diff && existsSync(diff) ? diff : undefined };
  });
  // Validate everything first, then write: a bad entry must not leave half the set accepted.
  return plan.map(({ f, from, to, diff }) => {
    const created = !existsSync(to);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    return {
      name: f.name,
      project: f.project,
      runnerProject: f.runnerProject,
      platform: f.platform,
      reason: f.reason,
      diffRatio: f.diffRatio,
      from,
      to,
      created,
      diff,
    };
  });
}
