import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import {
  CucumberExpression,
  ParameterType,
  ParameterTypeRegistry,
  RegularExpression,
  type Expression,
} from '@cucumber/cucumber-expressions';
import type { GherkinDocument } from '@cucumber/messages';
import type { LintFinding, ProjectConfig } from '@sdods/contracts';
import type { ts as TsNamespace } from 'ts-morph';
import { parseTagExpr } from '../config/tags.js';
import { coreStepNames, coreStepsDir, coreStepsPatterns } from '../steps/glob.js';
import type { ParsedFeature } from './gherkin.js';

/**
 * Ambiguous step definitions (#60).
 *
 * playwright-bdd refuses to generate specs when one scenario step matches more than one definition
 * ("Multiple definitions matched scenario step"), and the core step libraries share one namespace
 * with a project's own steps — so a phrasing a project wrote before a library shipped the same
 * text breaks the whole suite at `sdods run`, while lint used to say "no findings".
 *
 * Definitions are read statically (no step file is executed, so lint stays fast and side-effect
 * free) from exactly the files the runner hands bddgen: the core libraries minus
 * `steps.core.exclude`, plus the project's `steps/**` and `pages/**`. They are matched against
 * pickle step text (outline rows expanded) with the same Cucumber expression engine and the same
 * rules bddgen uses: keywords are ignored, tag-scoped definitions are filtered by the scenario's
 * tags, and `@skip` / `@fixme` scenarios are not matched. A pattern that is not a literal, or that
 * names a parameter type lint cannot see, is left out rather than guessed at: this check must
 * never fail a suite that bddgen would generate.
 */

const STEP_FNS = new Set(['Given', 'When', 'Then', 'Step']);

interface StepDef {
  pattern: string | RegExp;
  file: string;
  line: number;
  /** core library name (`a11y`) or undefined for a project file */
  library?: string;
  /** literal `tags` option; `null` when present but not a literal (cannot be evaluated) */
  tags?: string | null;
  expression?: Expression;
}

interface ParamTypeDef {
  name: string;
  regexps: Array<string | RegExp>;
}

type TsModule = typeof TsNamespace;

function walk(dir: string, out: string[]) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
}

function literalRegExp(text: string): RegExp | undefined {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(text);
  if (!m) return undefined;
  try {
    return new RegExp(m[1]!, m[2]);
  } catch {
    return undefined;
  }
}

function extract(
  ts: TsModule,
  file: string,
  library: string | undefined,
): { steps: StepDef[]; params: ParamTypeDef[] } {
  const steps: StepDef[] = [];
  const params: ParamTypeDef[] = [];
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  const stringOf = (n: TsNamespace.Node | undefined): string | RegExp | undefined => {
    if (!n) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isRegularExpressionLiteral(n)) return literalRegExp(n.text);
    return undefined;
  };
  const visit = (node: TsNamespace.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name && STEP_FNS.has(name) && node.arguments.length) {
        const pattern = stringOf(node.arguments[0]);
        if (pattern !== undefined) {
          const def: StepDef = {
            pattern,
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            library,
          };
          const opts = node.arguments[1];
          if (opts && ts.isObjectLiteralExpression(opts)) {
            for (const prop of opts.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
                prop.name.text === 'tags'
              ) {
                const tags = stringOf(prop.initializer);
                def.tags = typeof tags === 'string' ? tags : null;
              } else if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'tags') {
                def.tags = null;
              }
            }
          }
          steps.push(def);
        }
      } else if (name === 'defineParameterType' && node.arguments[0]) {
        const arg = node.arguments[0];
        if (ts.isObjectLiteralExpression(arg)) {
          let pname: string | undefined;
          const regexps: Array<string | RegExp> = [];
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            if (prop.name.text === 'name') {
              const v = stringOf(prop.initializer);
              if (typeof v === 'string') pname = v;
            } else if (prop.name.text === 'regexp') {
              const init = prop.initializer;
              const items = ts.isArrayLiteralExpression(init) ? [...init.elements] : [init];
              for (const item of items) {
                const v = stringOf(item);
                if (v !== undefined) regexps.push(v);
              }
            }
          }
          if (pname && regexps.length) params.push({ name: pname, regexps });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { steps, params };
}

/** Gherkin step id → line, across backgrounds, scenarios and rules. */
function stepLines(doc: GherkinDocument): Map<string, number> {
  const lines = new Map<string, number>();
  const children = (list: NonNullable<GherkinDocument['feature']>['children']) => {
    for (const c of list) {
      const block = c.background ?? c.scenario;
      for (const s of block?.steps ?? []) lines.set(s.id, s.location.line);
      if (c.rule) children(c.rule.children as NonNullable<GherkinDocument['feature']>['children']);
    }
  };
  if (doc.feature) children(doc.feature.children);
  return lines;
}

export interface AmbiguityCheckOptions {
  project: ProjectConfig & { root: string };
  features: ParsedFeature[];
}

export async function checkStepAmbiguity(
  opts: AmbiguityCheckOptions,
): Promise<{ errors: LintFinding[]; warnings: LintFinding[] }> {
  const { project, features } = opts;
  const errors: LintFinding[] = [];
  const warnings: LintFinding[] = [];
  const rel = (f: string) => relative(project.root, f).replace(/\\/g, '/');
  const exclude = project.steps?.core?.exclude ?? [];

  try {
    coreStepsPatterns(exclude);
  } catch (e) {
    errors.push({
      severity: 'error',
      rule: 'steps/core-exclude',
      message: `${(e as Error).message} ${(e as { hint?: string }).hint ?? ''}`.trim(),
      file: 'sdods.project.yaml',
    });
  }

  const { ts } = await import('ts-morph');
  const dir = coreStepsDir();
  const coreFile = (name: string) =>
    [`${name}.ts`, `${name}.js`].map((f) => join(dir, f)).find((f) => existsSync(f));

  const defs: StepDef[] = [];
  const paramDefs: ParamTypeDef[] = [];
  const add = (file: string | undefined, library?: string) => {
    if (!file) return;
    const r = extract(ts, file, library);
    defs.push(...r.steps);
    paramDefs.push(...r.params);
  };
  add(coreFile('params'));
  for (const lib of coreStepNames()) {
    if (!exclude.includes(lib)) add(coreFile(`${lib}.steps`), lib);
  }
  const projectFiles: string[] = [];
  walk(join(project.root, 'steps'), projectFiles);
  walk(join(project.root, 'pages'), projectFiles);
  for (const f of projectFiles) add(f);

  const registry = new ParameterTypeRegistry();
  for (const p of paramDefs) {
    try {
      registry.defineParameterType(
        new ParameterType(p.name, p.regexps as RegExp[], null, (s: string) => s, false, false),
      );
    } catch {
      /* already defined (a project re-declaring a core type) — the first one wins */
    }
  }
  const usable = defs.filter((d) => {
    try {
      d.expression =
        typeof d.pattern === 'string'
          ? new CucumberExpression(d.pattern, registry)
          : new RegularExpression(d.pattern, registry);
      return true;
    } catch {
      return false; // e.g. a parameter type defined dynamically — never guess
    }
  });
  const tagExpr = new Map<string, { evaluate(tags: readonly string[]): boolean }>();
  for (const d of usable) {
    if (typeof d.tags === 'string' && !tagExpr.has(d.tags)) {
      try {
        tagExpr.set(d.tags, parseTagExpr(d.tags));
      } catch {
        d.tags = null;
      }
    }
  }

  const describe = (d: StepDef) =>
    d.library ? `${basename(d.file)}:${d.line}` : `${rel(d.file)}:${d.line}`;
  const originOf = (d: StepDef) => (d.library ? `core library "${d.library}"` : rel(d.file));

  // text → definitions matching it by text alone (tags applied per scenario below)
  const byText = new Map<string, StepDef[]>();
  const matching = (text: string) => {
    let hit = byText.get(text);
    if (!hit) {
      hit = usable.filter((d) => d.expression!.match(text) !== null);
      byText.set(text, hit);
    }
    return hit;
  };

  interface Group {
    defs: StepDef[];
    origins: string[];
    libraries: string[];
    occurrences: Map<string, { file: string; line: number; text: string; defs: StepDef[] }>;
  }
  const groups = new Map<string, Group>();
  const usedAmbiguous = new Set<StepDef>();

  for (const feature of features) {
    if (feature.errors.length) continue;
    const lines = stepLines(feature.document);
    for (const pickle of feature.pickles) {
      const tags = pickle.tags.map((t) => t.name);
      if (tags.includes('@skip') || tags.includes('@fixme')) continue;
      for (const step of pickle.steps) {
        let matched = matching(step.text);
        if (matched.length < 2) continue;
        if (tags.length) {
          const tagged = matched.filter(
            (d) => typeof d.tags === 'string' && tagExpr.get(d.tags)!.evaluate(tags),
          );
          matched = tagged.length ? tagged : matched.filter((d) => d.tags === undefined);
        }
        // A tag option lint cannot read might be what separates them: say nothing.
        if (matched.length < 2 || matched.some((d) => d.tags === null)) continue;
        const origins = [...new Set(matched.map(originOf))].sort();
        const key = origins.join(' ');
        let g = groups.get(key);
        if (!g) {
          g = {
            defs: [],
            origins,
            libraries: [...new Set(matched.flatMap((d) => (d.library ? [d.library] : [])))].sort(),
            occurrences: new Map(),
          };
          groups.set(key, g);
        }
        const line = lines.get(step.astNodeIds[0]!) ?? 0;
        const loc = `${rel(feature.file)}:${line}`;
        if (!g.occurrences.has(loc))
          g.occurrences.set(loc, { file: rel(feature.file), line, text: step.text, defs: matched });
        for (const d of matched) usedAmbiguous.add(d);
      }
    }
  }

  const excludeHint = (libraries: string[]) =>
    libraries.length
      ? ` Rename or remove the project definition, or drop the library with steps.core.exclude: [${libraries.join(', ')}] in sdods.project.yaml.`
      : ' Remove or reword one of the definitions.';

  for (const g of groups.values()) {
    const occ = [...g.occurrences.values()];
    const first = occ[0]!;
    const examples = occ
      .slice(0, 3)
      .map((o) => `"${o.text}" (${o.file}:${o.line}) → ${o.defs.map(describe).join(', ')}`)
      .join('; ');
    const more = occ.length > 3 ? `; and ${occ.length - 3} more` : '';
    const where =
      g.origins.length === 1
        ? `more than one definition in ${g.origins[0]}`
        : `definitions in both ${g.origins.join(' and ')}`;
    errors.push({
      severity: 'error',
      rule: 'steps/ambiguous',
      message:
        `${occ.length} step(s) match ${where}; bddgen fails with "Multiple definitions matched scenario step". ` +
        `${examples}${more}.${excludeHint(g.libraries)}`,
      file: first.file,
      line: first.line,
    });
  }

  // The same phrasing defined twice with a project file involved, not used by any feature yet.
  const dupes = new Map<string, StepDef[]>();
  for (const d of usable) {
    if (d.tags !== undefined) continue;
    const key = typeof d.pattern === 'string' ? `s:${d.pattern}` : `r:${d.pattern.source}`;
    dupes.set(key, [...(dupes.get(key) ?? []), d]);
  }
  const dupGroups = new Map<
    string,
    { origins: string[]; libraries: string[]; sets: StepDef[][] }
  >();
  for (const set of dupes.values()) {
    if (set.length < 2 || set.every((d) => d.library) || set.some((d) => usedAmbiguous.has(d)))
      continue;
    const origins = [...new Set(set.map(originOf))].sort();
    const key = origins.join(' ');
    const g = dupGroups.get(key) ?? {
      origins,
      libraries: [...new Set(set.flatMap((d) => (d.library ? [d.library] : [])))].sort(),
      sets: [],
    };
    g.sets.push(set);
    dupGroups.set(key, g);
  }
  for (const g of dupGroups.values()) {
    const firstProject = g.sets[0]!.find((d) => !d.library)!;
    const examples = g.sets
      .slice(0, 3)
      .map((set) => `"${String(set[0]!.pattern)}" at ${set.map(describe).join(', ')}`)
      .join('; ');
    const more = g.sets.length > 3 ? `; and ${g.sets.length - 3} more` : '';
    warnings.push({
      severity: 'warning',
      rule: 'steps/duplicate',
      message:
        `${g.sets.length} phrasing(s) defined in ${g.origins.join(' and ')}; the first feature to use one will fail generation. ` +
        `${examples}${more}.${excludeHint(g.libraries)}`,
      file: rel(firstProject.file),
      line: firstProject.line,
    });
  }

  return { errors, warnings };
}
