import { readFileSync } from 'node:fs';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument, type Pickle } from '@cucumber/messages';
import { compile } from '@cucumber/gherkin';

export interface ParsedFeature {
  file: string;
  document: GherkinDocument;
  pickles: readonly Pickle[];
  errors: Array<{ message: string; line?: number; column?: number }>;
}

/** Parse a feature file to AST + pickles (pickles carry effective tags: feature + scenario + examples). */
export function parseFeatureFile(file: string, text = readFileSync(file, 'utf8')): ParsedFeature {
  const newId = IdGenerator.uuid();
  const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
  try {
    const document = parser.parse(text);
    document.uri = file;
    const pickles = compile(document, file, newId);
    return { file, document, pickles, errors: [] };
  } catch (e) {
    const err = e as Error & {
      errors?: Array<Error & { location?: { line: number; column?: number } }>;
      location?: { line: number; column?: number };
    };
    const list = err.errors?.length ? err.errors : [err];
    return {
      file,
      document: { uri: file, comments: [] } as GherkinDocument,
      pickles: [],
      errors: list.map((x) => ({
        message: x.message.replace(/^\(\d+:\d+\): /, ''),
        line: x.location?.line,
        column: x.location?.column,
      })),
    };
  }
}

export interface ScenarioInfo {
  name: string;
  line: number;
  tags: string[];
  isOutline: boolean;
  hasTitleFormat: boolean;
  steps: Array<{ keyword: string; text: string; line: number }>;
}

/** Scenario-level info from the AST (used by features list, lint, coverage). */
export function scenariosOf(parsed: ParsedFeature): ScenarioInfo[] {
  const out: ScenarioInfo[] = [];
  const feature = parsed.document.feature;
  if (!feature) return out;
  const featureTags = feature.tags.map((t) => t.name);
  const walk = (children: typeof feature.children, inherited: string[]) => {
    for (const child of children) {
      if (child.rule) {
        walk(child.rule.children, [...inherited, ...child.rule.tags.map((t) => t.name)]);
        continue;
      }
      const sc = child.scenario;
      if (!sc) continue;
      const isOutline = sc.examples.length > 0;
      const lastLine = Math.max(
        sc.location.line,
        ...sc.examples.flatMap((ex) => [
          ex.location.line,
          ...ex.tableBody.map((r) => r.location.line),
        ]),
      );
      const hasTitleFormat =
        isOutline &&
        parsed.document.comments.some(
          (c) =>
            /#\s*title-format:/i.test(c.text) &&
            c.location.line >= sc.location.line - 2 &&
            c.location.line <= lastLine,
        );
      const exampleTags = sc.examples.flatMap((ex) => ex.tags.map((t) => t.name));
      out.push({
        name: sc.name,
        line: sc.location.line,
        tags: [...new Set([...inherited, ...sc.tags.map((t) => t.name), ...exampleTags])],
        isOutline,
        hasTitleFormat,
        steps: sc.steps.map((s) => ({
          keyword: s.keyword.trim(),
          text: s.text,
          line: s.location.line,
        })),
      });
    }
  };
  walk(feature.children, featureTags);
  return out;
}
