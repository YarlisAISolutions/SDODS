import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseYaml } from 'yaml';
import type { Scenario, Tag } from '@cucumber/messages';
import {
  MATRIX_NAME_RE,
  ROLES_MATRIX_FILE,
  RolesMatrixFileSchema,
  type ProjectConfig,
  type RolesMatrixRowInput,
} from '@sdods/contracts';
import { resolveDataPath } from '../data/resolve-path.js';
import { parseFeatureFile } from '../lint/gherkin.js';

/**
 * Role matrix (#118): `roles.matrix.yaml` declares, per surface, the outcome each role should see;
 * a `@matrix:<name>` Scenario Outline is the template; `sdods matrix expand` writes one `Examples:`
 * block per role, tagged `@user:<role>`, between marker comments.
 *
 * playwright-bdd has no hook for external Examples, so the rows are generated INTO the feature file
 * rather than injected at bddgen time. That keeps the generated tests visible in review, in
 * `sdods features list`, and to every tool that reads Gherkin, at the cost of a generator that has
 * to be idempotent and must never touch rows a person wrote.
 */

export { ROLES_MATRIX_FILE };

export const MATRIX_BEGIN = 'sdods:matrix:begin';
export const MATRIX_END = 'sdods:matrix:end';
const BEGIN_RE = /^\s*#\s*sdods:matrix:begin\s+(\S+)/;
const END_RE = /^\s*#\s*sdods:matrix:end\b/;
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const RESERVED_COLUMNS = new Set(['role', 'expect', 'default']);

export interface RolesMatrix {
  name: string;
  description?: string;
  roles: string[];
  /** Row columns in declaration order, excluding `role` and `expect`. */
  columns: string[];
  /** `# title-format:` written above every generated block. */
  title: string;
  rows: Array<{ values: Record<string, string>; expect: Record<string, string> }>;
  /** 1-based line of `<name>:` in the yaml, for findings. */
  line?: number;
}

export interface MatrixProblem {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  /** Relative to the project root. */
  file: string;
  line?: number;
}

export interface LoadedMatrices {
  file: string;
  /** Every name under `matrices:`, valid or not, so an invalid matrix is not also reported as unknown. */
  declared: string[];
  matrices: Map<string, RolesMatrix>;
  problems: MatrixProblem[];
}

/** Read and validate `roles.matrix.yaml`. Undefined when the project has none. */
export function loadRolesMatrices(projectRoot: string): LoadedMatrices | undefined {
  const file = join(projectRoot, ROLES_MATRIX_FILE);
  if (!existsSync(file)) return undefined;
  return parseRolesMatrices(readFileSync(file, 'utf8'), file);
}

/** Validate matrix yaml text. Problems never throw: lint reports them as findings. */
export function parseRolesMatrices(text: string, file = ROLES_MATRIX_FILE): LoadedMatrices {
  const matrices = new Map<string, RolesMatrix>();
  const problems: MatrixProblem[] = [];
  const problem = (message: string, line?: number) =>
    problems.push({
      rule: 'matrix/config',
      severity: 'error',
      message,
      file: ROLES_MATRIX_FILE,
      line,
    });
  let raw: unknown;
  try {
    raw = parseYaml(text) ?? {};
  } catch (e) {
    problem(`Cannot parse YAML: ${(e as Error).message.split('\n')[0]}`);
    return { file, declared: [], matrices, problems };
  }
  const rawMatrices = (raw as { matrices?: unknown } | null)?.matrices;
  const declared =
    rawMatrices && typeof rawMatrices === 'object' ? Object.keys(rawMatrices as object) : [];
  const parsed = RolesMatrixFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problem(`${issue.path.join('.') || '<root>'}: ${issue.message}`);
    return { file, declared, matrices, problems };
  }
  const lines = text.split(/\r?\n/);
  const lineOf = (name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const i = lines.findIndex((l) => new RegExp(`^\\s+['"]?${escaped}['"]?\\s*:`).test(l));
    return i >= 0 ? i + 1 : undefined;
  };

  for (const [name, m] of Object.entries(parsed.data.matrices)) {
    const line = lineOf(name);
    const at = (msg: string) => problem(`matrices.${name}: ${msg}`, line);
    const before = problems.length;
    if (!MATRIX_NAME_RE.test(name))
      at('a matrix name is lowercase letters, digits and dashes (it is used as @matrix:<name>).');
    const dupRoles = m.roles.filter((r, i) => m.roles.indexOf(r) !== i);
    if (dupRoles.length) at(`role listed twice: ${[...new Set(dupRoles)].join(', ')}.`);

    const columnsOf = (row: RolesMatrixRowInput) =>
      Object.keys(row).filter((k) => k !== 'expect' && k !== 'default');
    const columns = columnsOf(m.rows[0]!);
    for (const c of columns) {
      if (!COLUMN_RE.test(c)) at(`column "${c}" is not a valid placeholder name.`);
      if (RESERVED_COLUMNS.has(c)) at(`column "${c}" is reserved.`);
    }

    const rows: RolesMatrix['rows'] = [];
    const seen = new Map<string, number>();
    m.rows.forEach((row, i) => {
      const where = `rows[${i}]`;
      const cols = columnsOf(row);
      const missing = columns.filter((c) => !cols.includes(c));
      const extra = cols.filter((c) => !columns.includes(c));
      if (missing.length || extra.length)
        at(
          `${where} has columns [${cols.join(', ')}]; every row needs the columns of rows[0] [${columns.join(', ')}].`,
        );
      const values: Record<string, string> = {};
      for (const c of columns) values[c] = row[c] === undefined ? '' : String(row[c]);
      const key = JSON.stringify(columns.map((c) => values[c]));
      if (seen.has(key)) at(`${where} repeats rows[${seen.get(key)}].`);
      else seen.set(key, i);

      const map = typeof row.expect === 'object' ? row.expect : undefined;
      if (map) {
        const unknown = Object.keys(map).filter((r) => !m.roles.includes(r));
        if (unknown.length)
          at(`${where}.expect names ${unknown.join(', ')}, not in roles [${m.roles.join(', ')}].`);
      }
      const expect: Record<string, string> = {};
      const unresolved: string[] = [];
      for (const role of m.roles) {
        const value =
          (typeof row.expect === 'string' ? row.expect : map?.[role]) ?? row.default ?? m.default;
        if (value === undefined) unresolved.push(role);
        else {
          if (m.outcomes && !m.outcomes.includes(value))
            at(
              `${where}: outcome "${value}" for ${role} is not in outcomes [${m.outcomes.join(', ')}].`,
            );
          expect[role] = value;
        }
      }
      if (unresolved.length)
        at(
          `${where} has no outcome for ${unresolved.join(', ')}; name them in expect or set a default.`,
        );
      rows.push({ values, expect });
    });

    const title = m.title ?? defaultTitle(columns);
    const titleUses = placeholders(title);
    for (const p of titleUses)
      if (!['role', 'expect', ...columns].includes(p))
        at(
          `title uses <${p}>, which is not a column (role, expect${columns.map((c) => `, ${c}`).join('')}).`,
        );
    // Every generated test is titled from this format, and Playwright refuses to load two tests with
    // the same title. Rows are unique by their columns, so <role> plus every column makes each title
    // unique; `<expect>` does not, since two roles often share an outcome.
    const leftOut = ['role', ...columns].filter((c) => !titleUses.includes(c));
    if (leftOut.length)
      at(
        `title "${title}" leaves out ${leftOut.map((c) => `<${c}>`).join(', ')}; a custom title needs <role> and every column (${columns.join(', ')}), or two generated tests can share a title and Playwright refuses to load them.`,
      );
    else if (problems.length === before) {
      // Adjacent placeholders can still collide (`<x><y>`: "ab"+"c" and "a"+"bc").
      const seenTitles = new Set<string>();
      titles: for (const role of m.roles)
        for (const row of rows) {
          const rendered = title.replace(/<([^<>\s]+)>/g, (whole, p: string) =>
            p === 'role' ? role : p === 'expect' ? row.expect[role]! : (row.values[p] ?? whole),
          );
          if (seenTitles.has(rendered)) {
            at(
              `title "${title}" renders "${rendered}" for more than one generated test; separate the placeholders so every title is unique.`,
            );
            break titles;
          }
          seenTitles.add(rendered);
        }
    }

    if (problems.length === before)
      matrices.set(name, {
        name,
        description: m.description,
        roles: m.roles,
        columns,
        title,
        rows,
        line,
      });
  }
  return { file, declared, matrices, problems };
}

function defaultTitle(columns: string[]): string {
  if (!columns.length) return '<role> → <expect>';
  return `<role>: ${columns.map((c) => `<${c}>`).join(' ')} → <expect>`;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]!);
}

// ── expansion ─────────────────────────────────────────────────────────────────

export interface ExpandResult {
  text: string;
  changed: boolean;
  /** Generated example rows in the file after expansion. */
  examples: number;
  problems: MatrixProblem[];
}

interface Edit {
  /** 0-based index of the first line replaced. */
  start: number;
  deleteCount: number;
  insert: string[];
}

interface ScenarioRef {
  sc: Scenario;
  /** First line of the scenario including its tags (1-based). */
  firstLine: number;
}

/**
 * Rewrite the generated Examples of every `@matrix:<name>` outline in one feature file.
 * Pure: text in, text out. Hand-written Examples and everything outside the markers are kept.
 */
export function expandFeatureText(
  text: string,
  matrices: ReadonlyMap<string, RolesMatrix>,
  opts: { file?: string } = {},
): ExpandResult {
  const file = opts.file ?? 'inline.feature';
  const problems: MatrixProblem[] = [];
  const problem = (rule: string, message: string, line?: number) =>
    problems.push({ rule, severity: 'error', message, file, line });
  const unchanged = (examples = 0): ExpandResult => ({ text, changed: false, examples, problems });

  if (!/@matrix:|sdods:matrix:/.test(text)) return unchanged();
  const parsed = parseFeatureFile(file, text);
  if (parsed.errors.length) return unchanged();
  const doc = parsed.document;
  const feature = doc.feature;
  if (!feature) return unchanged();

  const isMatrixTag = (t: Tag) => t.name.startsWith('@matrix:');
  for (const t of feature.tags.filter(isMatrixTag))
    problem(
      'matrix/template',
      `${t.name} belongs on the Scenario Outline, not the Feature.`,
      t.location.line,
    );

  const scenarios: ScenarioRef[] = [];
  for (const child of feature.children) {
    if (child.scenario) scenarios.push(ref(child.scenario));
    if (child.rule) {
      for (const t of child.rule.tags.filter(isMatrixTag))
        problem(
          'matrix/template',
          `${t.name} belongs on the Scenario Outline, not the Rule.`,
          t.location.line,
        );
      for (const c of child.rule.children) if (c.scenario) scenarios.push(ref(c.scenario));
    }
  }
  scenarios.sort((a, b) => a.sc.location.line - b.sc.location.line);

  // Marker pairs, in order.
  const pairs: Array<{ name: string; begin: number; end: number }> = [];
  let open: { name: string; begin: number } | undefined;
  for (const c of [...doc.comments].sort((a, b) => a.location.line - b.location.line)) {
    const b = BEGIN_RE.exec(c.text);
    if (b) {
      if (open) {
        problem('matrix/markers', `"# ${MATRIX_BEGIN}" without a matching end.`, open.begin);
        return unchanged();
      }
      open = { name: b[1]!, begin: c.location.line };
    } else if (END_RE.test(c.text)) {
      if (!open) {
        problem('matrix/markers', `"# ${MATRIX_END}" without a matching begin.`, c.location.line);
        return unchanged();
      }
      pairs.push({ ...open, end: c.location.line });
      open = undefined;
    }
  }
  if (open) {
    problem('matrix/markers', `"# ${MATRIX_BEGIN}" without a matching end.`, open.begin);
    return unchanged();
  }

  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const edits: Edit[] = [];
  const claimed = new Set<(typeof pairs)[number]>();
  let examples = 0;

  scenarios.forEach(({ sc }, i) => {
    const next = scenarios[i + 1];
    const inside = pairs.filter(
      (p) => p.begin > sc.location.line && (!next || p.begin < next.firstLine),
    );
    const tags = sc.tags.filter(isMatrixTag);
    if (!tags.length) return;
    const line = sc.location.line;
    if (tags.length > 1) {
      problem(
        'matrix/template',
        `A scenario takes one @matrix tag; found ${tags.map((t) => t.name).join(' ')}.`,
        line,
      );
      inside.forEach((p) => claimed.add(p));
      return;
    }
    const name = tags[0]!.name.slice('@matrix:'.length);
    const matrix = matrices.get(name);
    if (!matrix) {
      // lint reports the unknown name on the tag itself (tags/matrix); keep the rows as they are.
      inside.forEach((p) => claimed.add(p));
      return;
    }
    const ownUser = sc.tags.find((t) => t.name.startsWith('@user:'));
    if (ownUser)
      problem(
        'matrix/template',
        `${ownUser.name} on a @matrix outline would override every generated role; remove it.`,
        ownUser.location.line,
      );

    // Gherkin fills a placeholder only from the Examples block its row belongs to, so each block is
    // checked on its own: the generated blocks supply role, expect and the matrix columns; every
    // hand-written block must supply every placeholder itself.
    const generatedExamples = (ex: Scenario['examples'][number]) =>
      inside.some((p) => ex.location.line > p.begin && ex.location.line < p.end);
    const used = [
      ...new Set<string>([
        ...placeholders(sc.name),
        ...sc.steps.flatMap((s) => [
          ...placeholders(s.text),
          ...placeholders(s.docString?.content ?? ''),
          ...(s.dataTable?.rows.flatMap((r) => r.cells.flatMap((c) => placeholders(c.value))) ??
            []),
        ]),
      ]),
    ];
    const generated = ['role', 'expect', ...matrix.columns];
    const unknown = used.filter((p) => !generated.includes(p));
    if (unknown.length)
      problem(
        'matrix/placeholder',
        `${unknown.map((p) => `<${p}>`).join(', ')} not provided by matrix "${name}" (columns: ${generated.join(', ')}).`,
        line,
      );
    for (const ex of sc.examples.filter((e) => !generatedExamples(e))) {
      // A block without a table produces no rows, so nothing to fill.
      if (!ex.tableHeader) continue;
      const header = ex.tableHeader.cells.map((c) => c.value);
      const missing = used.filter((p) => !header.includes(p));
      if (missing.length)
        problem(
          'matrix/placeholder',
          `Examples${ex.name ? ` "${ex.name}"` : ''} does not supply ${missing.map((p) => `<${p}>`).join(', ')}; Gherkin fills a placeholder only from the Examples block its row is in.`,
          ex.location.line,
        );
    }

    const indent = sc.steps[0]
      ? ' '.repeat(sc.steps[0].location.column! - 1)
      : ' '.repeat((sc.location.column ?? 1) + 1);
    const block = renderBlock(matrix, indent);
    examples += matrix.roles.length * matrix.rows.length;

    const [first, ...rest] = inside;
    if (first) {
      claimed.add(first);
      edits.push({
        start: first.begin - 1,
        deleteCount: first.end - first.begin + 1,
        insert: block,
      });
      for (const p of rest) {
        claimed.add(p);
        edits.push(removal(p, lines));
      }
    } else {
      edits.push({ start: lastLineOf(sc, lines), deleteCount: 0, insert: ['', ...block] });
    }
  });

  // Generated blocks whose outline lost its @matrix tag are generated rows with no source: drop them.
  for (const p of pairs) if (!claimed.has(p)) edits.push(removal(p, lines));

  if (!edits.length) return unchanged(examples);
  const out = [...lines];
  for (const e of edits.sort((a, b) => b.start - a.start))
    out.splice(e.start, e.deleteCount, ...e.insert);
  const next = out.join(eol);
  return { text: next, changed: next !== text, examples, problems };

  function ref(sc: Scenario): ScenarioRef {
    return { sc, firstLine: Math.min(sc.location.line, ...sc.tags.map((t) => t.location.line)) };
  }
}

/** Remove a marker pair and the blank line the generator put above it. */
function removal(p: { begin: number; end: number }, lines: string[]): Edit {
  const blankAbove = p.begin >= 2 && lines[p.begin - 2]!.trim() === '';
  const start = blankAbove ? p.begin - 2 : p.begin - 1;
  return { start, deleteCount: p.end - start, insert: [] };
}

/** 0-based index just after the last line that belongs to the scenario (steps, tables, docstrings, examples). */
function lastLineOf(sc: Scenario, lines: string[]): number {
  let last = sc.location.line;
  for (const s of sc.steps) {
    last = Math.max(last, s.location.line);
    for (const r of s.dataTable?.rows ?? []) last = Math.max(last, r.location.line);
    if (s.docString) {
      const open = s.docString.location.line;
      const delimiter = s.docString.delimiter;
      let close = open;
      for (let i = open; i < lines.length; i++) {
        if (lines[i]!.trim().startsWith(delimiter)) {
          close = i + 1;
          break;
        }
      }
      last = Math.max(last, close);
    }
  }
  for (const ex of sc.examples) {
    last = Math.max(last, ex.location.line, ex.tableHeader?.location.line ?? 0);
    for (const r of ex.tableBody) last = Math.max(last, r.location.line);
  }
  return last;
}

/** The generated region for one outline: a title-format, a role tag and a table per role. */
export function renderBlock(matrix: RolesMatrix, indent: string): string[] {
  const header = ['role', ...matrix.columns, 'expect'];
  const out = [
    `${indent}# ${MATRIX_BEGIN} ${matrix.name} (generated by \`sdods matrix expand\` from ${ROLES_MATRIX_FILE}; edit the matrix, not these rows)`,
  ];
  matrix.roles.forEach((role, i) => {
    const rows = matrix.rows.map((r) => [
      role,
      ...matrix.columns.map((c) => r.values[c]!),
      r.expect[role]!,
    ]);
    const cells = [header, ...rows].map((row) => row.map(escapeCell));
    const widths = header.map((_, c) => Math.max(...cells.map((row) => row[c]!.length)));
    if (i > 0) out.push('');
    out.push(`${indent}# title-format: ${matrix.title}`);
    out.push(`${indent}@user:${role}`);
    out.push(`${indent}Examples: ${role}`);
    for (const row of cells)
      out.push(`${indent}  | ${row.map((v, c) => v.padEnd(widths[c]!)).join(' | ')} |`);
  });
  out.push(`${indent}# ${MATRIX_END} ${matrix.name}`);
  return out;
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '\\n');
}

// ── project-level plan ───────────────────────────────────────────────────────

export interface MatrixFilePlan {
  /** Absolute path. */
  file: string;
  /** Relative to the project root. */
  path: string;
  changed: boolean;
  examples: number;
  before: string;
  after: string;
  problems: MatrixProblem[];
}

export interface MatrixPlan {
  loaded?: LoadedMatrices;
  files: MatrixFilePlan[];
  /** Config, role and pool findings (not tied to one feature). */
  problems: MatrixProblem[];
}

/**
 * Everything `sdods matrix expand`, `--check`, lint and the MCP tool need, computed once:
 * the matrices, their project-level findings, and the before/after text of every feature that
 * uses (or used to use) a matrix.
 */
export function planMatrixExpansion(
  project: ProjectConfig & { root: string },
  featureFiles: string[],
): MatrixPlan {
  const loaded = loadRolesMatrices(project.root);
  const matrices = loaded?.matrices ?? new Map<string, RolesMatrix>();
  const problems: MatrixProblem[] = [
    ...(loaded?.problems ?? []),
    ...(loaded ? checkMatrixRoles(project, matrices) : []),
  ];
  const files: MatrixFilePlan[] = [];
  for (const file of featureFiles) {
    const before = readFileSync(file, 'utf8');
    if (!/@matrix:|sdods:matrix:/.test(before)) continue;
    const path = relative(project.root, file).replace(/\\/g, '/');
    const r = expandFeatureText(before, matrices, { file: path });
    // With an invalid matrix file every name looks unknown; do not rewrite features from that.
    const usable = !loaded?.problems.length;
    files.push({
      file,
      path,
      changed: usable && r.changed,
      examples: r.examples,
      before,
      after: usable ? r.text : before,
      problems: r.problems,
    });
  }
  return { loaded, files, problems };
}

/**
 * Roles the matrix names must be roles the project declares, and each needs an account to lease.
 *
 * The matrix does not create identities. A role with no pool row turns every generated scenario for
 * that role red with a lease error that says nothing about the product, so this is surfaced before
 * anything runs — per environment, because a role seeded on staging may not exist locally.
 */
export function checkMatrixRoles(
  project: ProjectConfig & { root: string },
  matrices: ReadonlyMap<string, RolesMatrix>,
): MatrixProblem[] {
  const out: MatrixProblem[] = [];
  const declared = project.tags.roles;
  const at = (m: RolesMatrix, rule: string, severity: 'error' | 'warning', message: string) =>
    out.push({ rule, severity, message, file: ROLES_MATRIX_FILE, line: m.line });

  for (const m of matrices.values()) {
    if (!declared.length)
      at(
        m,
        'matrix/role',
        'warning',
        `matrices.${m.name}: the project declares no tags.roles, so its roles cannot be checked.`,
      );
    else {
      const unknown = m.roles.filter((r) => !declared.includes(r));
      if (unknown.length)
        at(
          m,
          'matrix/role',
          'error',
          `matrices.${m.name}: ${unknown.join(', ')} ${unknown.length > 1 ? 'are not declared roles' : 'is not a declared role'} (tags.roles: ${declared.join(', ')}).`,
        );
    }
  }

  const pool = project.data.userPool;
  const used = [...new Set([...matrices.values()].flatMap((m) => m.roles))];
  if (!used.length) return out;
  if (!pool) {
    for (const m of matrices.values())
      at(
        m,
        'matrix/unseeded-role',
        'warning',
        `matrices.${m.name}: the project has no data.userPool, so no @user:<role> scenario can lease an account.`,
      );
    return out;
  }
  const seeded = poolRolesByEnv(project);
  if (!seeded) return out; // a db/openapi dataset: not knowable without connecting
  for (const m of matrices.values()) {
    for (const role of m.roles) {
      const missing = [...seeded].filter(([, roles]) => !roles.has(role)).map(([env]) => env);
      if (missing.length)
        at(
          m,
          'matrix/unseeded-role',
          'warning',
          `matrices.${m.name}: role "${role}" has no account in pool dataset "${pool.dataset}" for env ${missing.join(', ')}; its ${m.rows.length} generated example(s) will fail to lease there.`,
        );
    }
  }
  return out;
}

/** Roles present in the user-pool dataset, per available environment. Undefined if not file-backed. */
export function poolRolesByEnv(
  project: ProjectConfig & { root: string },
): Map<string, Set<string>> | undefined {
  const counts = poolAccountsByEnv(project);
  if (!counts) return undefined;
  return new Map([...counts].map(([env, roles]) => [env, new Set(roles.keys())]));
}

/**
 * Accounts per role in the user-pool dataset, per available environment. Undefined if not
 * file-backed (a db or openapi dataset is not knowable without connecting).
 *
 * `poolSize` is the env's `users.poolSize`, applied as the lease applies it: the dataset is sliced
 * BEFORE rows are split by role, so a small value can leave a role with no account at all.
 */
export function poolAccountsByEnv(
  project: ProjectConfig & { root: string },
  opts: { envs?: readonly string[]; poolSize?: (env: string) => number | undefined } = {},
): Map<string, Map<string, number>> | undefined {
  const pool = project.data.userPool;
  const spec = pool ? project.data.sources[pool.dataset] : undefined;
  if (!pool || !spec || !('path' in spec)) return undefined;
  const out = new Map<string, Map<string, number>>();
  for (const env of opts.envs ?? project.envs.available) {
    let file: string;
    try {
      file = resolveDataPath(project.root, spec, env);
    } catch {
      out.set(env, new Map());
      continue;
    }
    let rows: Array<Record<string, unknown>> = [];
    try {
      const text = readFileSync(file, 'utf8');
      if (spec.type === 'csv')
        rows = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
      else {
        const raw = spec.type === 'json' ? JSON.parse(text) : parseYaml(text);
        rows = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
      }
    } catch {
      rows = [];
    }
    const size = opts.poolSize?.(env);
    if (size) rows = rows.slice(0, size);
    const roles = new Map<string, number>();
    // Same fallback as the lease: a row without a role column is a "standard" account.
    for (const r of rows) {
      const role = String(r[pool.roleColumn] ?? 'standard');
      roles.set(role, (roles.get(role) ?? 0) + 1);
    }
    out.set(env, roles);
  }
  return out;
}
