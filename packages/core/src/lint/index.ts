import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execa } from 'execa';
import type { LintFinding, LintResult } from '@sdods/contracts';
import type { ProjectConfig } from '@sdods/contracts';
import {
  BROWSERS_FOR_SKIP,
  KNOWN_VALUE_TAGS,
  LAYER_TAGS,
  RUNNER_SPECIAL_TAGS,
  VALUE_TAG,
  taxonomyFromProject,
} from '../config/tags.js';
import { moduleForFeature } from '../config/workspace.js';
import { emulationTagProblem } from '../config/emulation.js';
import { parseFeatureFile, scenariosOf, type ParsedFeature } from './gherkin.js';
import { checkStepAmbiguity } from './steps.js';

export * from './gherkin.js';

export interface LintOptions {
  project: ProjectConfig & { root: string };
  files?: string[];
  /** run bddgen with missingSteps: fail-on-gen to detect undefined steps (slower) */
  undefinedSteps?: boolean;
  repoRoot?: string;
  fixTags?: boolean;
}

export function listFeatureFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__screenshots__') walk(p);
      } else if (name.endsWith('.feature')) out.push(p);
    }
  };
  walk(join(root, 'features'));
  return out;
}

export async function lintProject(opts: LintOptions): Promise<LintResult> {
  const { project } = opts;
  const files = opts.files?.length ? opts.files : listFeatureFiles(project.root);
  const tax = taxonomyFromProject(project);
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const rel = (f: string) => relative(project.root, f).replace(/\\/g, '/');
  const parsedFeatures: ParsedFeature[] = [];

  for (const file of files) {
    const parsed = parseFeatureFile(file);
    parsedFeatures.push(parsed);
    for (const e of parsed.errors)
      errors.push({
        severity: 'error',
        rule: 'gherkin/syntax',
        message: e.message,
        file: rel(file),
        line: e.line,
        column: e.column,
      });
    if (parsed.errors.length) continue;
    const mod = moduleForFeature(project, file);
    if (project.modules.length && !mod) {
      warnings.push({
        severity: 'warning',
        rule: 'module/unassigned',
        message: `Feature is not under a declared module directory (${project.modules.map((m) => `features/${m.path ?? m.name}`).join(', ')}).`,
        file: rel(file),
        line: 1,
      });
    }
    const scenarios = scenariosOf(parsed);
    const seen = new Map<string, number>();
    for (const sc of scenarios) {
      const loc = { file: rel(file), line: sc.line };
      const layerTags = sc.tags.filter((t) => (LAYER_TAGS as readonly string[]).includes(t));
      if (layerTags.length !== 1) {
        const dirLayer =
          /\/features\/(ui|api|hybrid)\//.exec(file.replace(/\\/g, '/'))?.[1] ?? mod?.layers?.[0];
        errors.push({
          severity: 'error',
          rule: 'tags/layer',
          message: `Scenario must carry exactly one layer tag (${LAYER_TAGS.join(', ')}); found ${layerTags.length ? layerTags.join(' ') : 'none'}.`,
          ...loc,
          fix:
            dirLayer && layerTags.length === 0
              ? { description: `add @${dirLayer}`, insertTag: `@${dirLayer}` }
              : undefined,
        });
      }
      const suiteTags = sc.tags.filter((t) => tax.suites.includes(t));
      if (suiteTags.length !== 1) {
        errors.push({
          severity: 'error',
          rule: 'tags/suite',
          message: `Scenario must carry exactly one suite tag (${tax.suites.join(', ')}); found ${suiteTags.length ? suiteTags.join(' ') : 'none'}.`,
          ...loc,
        });
      }
      for (const tag of sc.tags) {
        if (
          (LAYER_TAGS as readonly string[]).includes(tag) ||
          tax.suites.includes(tag) ||
          tax.extra.includes(tag)
        )
          continue;
        if (RUNNER_SPECIAL_TAGS.test(tag)) continue;
        if (mod?.tags.includes(tag)) continue;
        if (project.modules.some((m) => m.tags.includes(tag))) continue;
        const m = VALUE_TAG.exec(tag);
        if (m) {
          const [, key, value] = m as unknown as [string, string, string];
          switch (key) {
            case 'env':
              if (!tax.envs.includes(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/env',
                  message: `@env:${value} is not in envs.available (${tax.envs.join(', ')}).`,
                  ...loc,
                });
              break;
            case 'user':
              if (tax.roles.length && !tax.roles.includes(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/user',
                  message: `@user:${value} is not a declared role (${tax.roles.join(', ')}).`,
                  ...loc,
                });
              break;
            case 'data':
              if (!tax.datasets.includes(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/data',
                  message: `@data:${value} is not a declared dataset (${tax.datasets.join(', ')}).`,
                  ...loc,
                });
              break;
            case 'har': {
              const name = value.replace(/:strict$/, '');
              const har = join(project.root, 'har');
              // The browser layer records <name>.har; the API layer records <name>.api.har.
              const exists =
                existsSync(har) &&
                readdirSync(har).some(
                  (env) =>
                    existsSync(join(har, env, `${name}.har`)) ||
                    existsSync(join(har, env, `${name}.api.har`)),
                );
              if (!exists)
                warnings.push({
                  severity: 'warning',
                  rule: 'tags/har',
                  message: `@har:${name} has no recorded file under har/<env>/${name}.har (or ${name}.api.har) yet.`,
                  ...loc,
                });
              break;
            }
            case 'jira':
              if (!/^[A-Z][A-Z0-9]+-\d+$/.test(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/jira',
                  message: `@jira:${value} must look like PROJ-123.`,
                  ...loc,
                });
              break;
            case 'github':
              if (!/^\d+$/.test(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/github',
                  message: `@github:${value} must be an issue number.`,
                  ...loc,
                });
              break;
            case 'skip':
              if (!(BROWSERS_FOR_SKIP as readonly string[]).includes(value))
                errors.push({
                  severity: 'error',
                  rule: 'tags/skip',
                  message: `@skip:${value} must name a browser (${BROWSERS_FOR_SKIP.join(', ')}).`,
                  ...loc,
                });
              break;
            case 'locale':
            case 'timezone':
            case 'theme':
            case 'viewport':
            case 'device': {
              const problem = emulationTagProblem(key, value);
              if (problem)
                errors.push({ severity: 'error', rule: `tags/${key}`, message: problem, ...loc });
              // One browser context per scenario, so one value per key (Feature tags included).
              // Outlines are exempt: their tag list folds in every Examples block, and one block
              // per locale (`@locale:fr` / `@locale:de`) is exactly the pattern these tags enable.
              // The runner still refuses a real conflict on a single example.
              const distinct = [...new Set(sc.tags.filter((t) => t.startsWith(`@${key}:`)))];
              if (!sc.isOutline && distinct.length > 1 && distinct[0] === tag)
                errors.push({
                  severity: 'error',
                  rule: `tags/${key}`,
                  message: `Conflicting ${distinct.join(' and ')}: a scenario takes one @${key}: value.`,
                  ...loc,
                });
              break;
            }
            default:
              if (!(KNOWN_VALUE_TAGS as readonly string[]).includes(key))
                warnings.push({
                  severity: 'warning',
                  rule: 'tags/unknown',
                  message: `Unknown value tag ${tag}.`,
                  ...loc,
                });
          }
          continue;
        }
        warnings.push({
          severity: 'warning',
          rule: 'tags/unknown',
          message: `Unknown tag ${tag}. Declare it under tags.extra or a module's tags in sdods.project.yaml.`,
          ...loc,
        });
      }
      if (mod) {
        const missing = mod.tags.filter((t) => !sc.tags.includes(t));
        if (missing.length)
          warnings.push({
            severity: 'warning',
            rule: 'module/tags',
            message: `Scenario lacks module "${mod.name}" tag(s): ${missing.join(' ')}.`,
            ...loc,
            fix: { description: `add ${missing[0]}`, insertTag: missing[0] },
          });
      }
      if (sc.isOutline && !sc.hasTitleFormat) {
        warnings.push({
          severity: 'warning',
          rule: 'outline/title-format',
          message:
            'Scenario Outline has no "# title-format:" comment; examples will be titled "Example #N".',
          ...loc,
        });
      }
      const key = sc.name.trim().toLowerCase();
      if (seen.has(key))
        errors.push({
          severity: 'error',
          rule: 'scenario/duplicate',
          message: `Duplicate scenario title "${sc.name}" (first at line ${seen.get(key)}).`,
          ...loc,
        });
      else seen.set(key, sc.line);
    }
  }

  // A phrasing matched by two definitions stops bddgen generating anything (#60).
  const ambiguity = await checkStepAmbiguity({ project, features: parsedFeatures });
  errors.push(...ambiguity.errors);
  warnings.push(...ambiguity.warnings);

  if (opts.undefinedSteps && opts.repoRoot) {
    const found = await detectUndefinedSteps(project, opts.repoRoot);
    for (const f of found) {
      const rule = f.rule ?? 'steps/undefined';
      // The static check above usually saw this ambiguity already; do not report it twice.
      if (errors.some((e) => e.rule === rule && e.file === f.file && e.line === f.line)) continue;
      errors.push({
        severity: 'error',
        rule,
        message: f.message,
        file: f.file ?? '',
        line: f.line,
      });
    }
  }

  return { errors, warnings, filesChecked: files.length };
}

/** Run bddgen with SDODS_LINT=1 (missingSteps: fail-on-gen) and parse the missing-step block. */
export async function detectUndefinedSteps(
  project: ProjectConfig & { root: string },
  repoRoot: string,
): Promise<Array<{ message: string; file?: string; line?: number; rule?: string }>> {
  const env = {
    ...process.env,
    SDODS_PROJECT: project.slug,
    SDODS_LINT: '1',
    SDODS_ARTIFACTS_DIR: join(repoRoot, '.sdods', 'lint'),
  };
  const result = await execa('npx', ['bddgen', '-c', join(repoRoot, 'sdods.runner.config.ts')], {
    cwd: repoRoot,
    env,
    reject: false,
    all: true,
  });
  if (result.exitCode === 0) return [];
  const text = result.all ?? '';
  const out: Array<{ message: string; file?: string; line?: number; rule?: string }> = [];
  let m: RegExpExecArray | null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    m = /^(.*\.feature):(\d+)$/.exec(line.trim());
    if (m) {
      const stepLine = lines[i + 1]?.trim() ?? '';
      out.push({
        message: `Undefined step: ${stepLine || '(see bddgen output)'}`,
        file: relative(project.root, m[1]!).replace(/\\/g, '/'),
        line: Number(m[2]),
      });
    }
  }
  if (!out.length && /Missing step definitions|missing step/i.test(text))
    out.push({
      message: text
        .split('\n')
        .filter((l) => /Missing|missing|Given|When|Then/.test(l))
        .slice(0, 10)
        .join(' | '),
    });
  // bddgen stops at the first ambiguous step. This parser only knew the missing-step block, so an
  // ambiguity (#60) — or any other generation failure — came back as "no findings".
  const ambiguous = /^Step: (.+?) # (.+\.feature):(\d+)(?::\d+)?$/;
  for (let i = 0; i < lines.length; i++) {
    const s = ambiguous.exec(lines[i]!.trim());
    if (!s || !/Multiple definitions matched/.test(lines[i - 1] ?? '')) continue;
    const variants: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j]!.trim().startsWith('- '); j++)
      variants.push(lines[j]!.trim().slice(2));
    out.push({
      rule: 'steps/ambiguous',
      message: `Multiple definitions matched "${s[1]}": ${variants.join('; ')}`,
      file: relative(project.root, resolve(repoRoot, s[2]!)).replace(/\\/g, '/'),
      line: Number(s[3]),
    });
  }
  if (!out.length) {
    const tail = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-5)
      .join(' | ');
    out.push({
      rule: 'steps/bddgen',
      message: `bddgen failed to generate specs (exit ${result.exitCode}): ${tail || '(no output)'}`,
    });
  }
  return out;
}

export function formatFindings(result: LintResult): string {
  const lines: string[] = [];
  for (const f of [...result.errors, ...result.warnings]) {
    lines.push(
      `${f.severity === 'error' ? '✖' : '⚠'} ${f.file}${f.line ? `:${f.line}` : ''}  ${f.rule}  ${f.message}`,
    );
  }
  lines.push(
    `${result.filesChecked} feature file(s), ${result.errors.length} error(s), ${result.warnings.length} warning(s)`,
  );
  return lines.join('\n');
}
