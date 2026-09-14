/**
 * Gherkin helpers that work on text alone: no file system, no CLI, no tool registry. Anything that
 * needs to check a feature it was handed (the MCP tools, Maxi on the docs site) imports these.
 */
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';

export interface ParsedScenario {
  name: string;
  line: number;
  keyword: string;
  tags: string[];
  steps: Array<{
    keyword: string;
    text: string;
    line: number;
    hasDocString: boolean;
    hasDataTable: boolean;
  }>;
  examplesRows?: number;
}

export interface ParsedFeature {
  path: string;
  name: string;
  tags: string[];
  background?: { steps: string[] };
  scenarios: ParsedScenario[];
  errors: string[];
}

export function parseGherkin(text: string, path = 'feature'): ParsedFeature {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  let doc: GherkinDocument;
  try {
    doc = parser.parse(text);
  } catch (e) {
    return { path, name: '', tags: [], scenarios: [], errors: [(e as Error).message] };
  }
  const feature = doc.feature;
  if (!feature)
    return { path, name: '', tags: [], scenarios: [], errors: ['No Feature keyword found'] };
  const featureTags = feature.tags.map((t) => t.name);
  const scenarios: ParsedScenario[] = [];
  let background: ParsedFeature['background'];
  const collect = (children: typeof feature.children, inherited: string[]) => {
    for (const child of children) {
      if (child.background)
        background = { steps: child.background.steps.map((s) => `${s.keyword.trim()} ${s.text}`) };
      if (child.rule)
        collect(child.rule.children, [...inherited, ...child.rule.tags.map((t) => t.name)]);
      const sc = child.scenario;
      if (!sc) continue;
      scenarios.push({
        name: sc.name,
        line: sc.location.line,
        keyword: sc.keyword,
        tags: [...inherited, ...sc.tags.map((t) => t.name)],
        steps: sc.steps.map((s) => ({
          keyword: s.keyword.trim(),
          text: s.text,
          line: s.location.line,
          hasDocString: Boolean(s.docString),
          hasDataTable: Boolean(s.dataTable),
        })),
        examplesRows: sc.examples.length
          ? sc.examples.reduce((n, ex) => n + ex.tableBody.length, 0)
          : undefined,
      });
    }
  };
  collect(feature.children, featureTags);
  return { path, name: feature.name, tags: featureTags, background, scenarios, errors: [] };
}

const LAYER_TAGS = ['@ui', '@api', '@hybrid'];

export function basicTagCheck(feature: ParsedFeature, suites: string[]): string[] {
  const problems: string[] = [];
  for (const sc of feature.scenarios) {
    const layers = sc.tags.filter((t) => LAYER_TAGS.includes(t));
    if (layers.length !== 1)
      problems.push(
        `${feature.path}:${sc.line} "${sc.name}": expected exactly one layer tag (@ui|@api|@hybrid), found ${layers.join(' ') || 'none'}`,
      );
    const suiteTags = sc.tags.filter((t) => suites.includes(t));
    if (suiteTags.length !== 1)
      problems.push(
        `${feature.path}:${sc.line} "${sc.name}": expected exactly one suite tag (${suites.join('|')}), found ${suiteTags.join(' ') || 'none'}`,
      );
  }
  return problems;
}

/** Token overlap similarity ignoring Cucumber parameter placeholders. */
export function similarity(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\{[a-z]+\}/g, ' ')
      .replace(/"[^"]*"/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.sqrt(ta.size * tb.size);
}
