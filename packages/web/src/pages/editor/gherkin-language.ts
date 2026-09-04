import { StreamLanguage } from '@codemirror/language';
import { gherkin } from '@codemirror/legacy-modes/mode/gherkin';

export const gherkinLanguage = StreamLanguage.define(gherkin);

export const GHERKIN_KEYWORDS = [
  'Feature',
  'Rule',
  'Background',
  'Scenario',
  'Scenario Outline',
  'Examples',
  'Given',
  'When',
  'Then',
  'And',
  'But',
] as const;

export interface ParsedFeature {
  featureLine: number | null;
  tags: string[];
  scenarios: Array<{ line: number; name: string; tags: string[]; outline: boolean }>;
}

/** Cheap client-side parse for tag chips, scenario navigation and quick diagnostics. */
export function parseFeatureText(text: string): ParsedFeature {
  const lines = text.split('\n');
  const out: ParsedFeature = { featureLine: null, tags: [], scenarios: [] };
  let pendingTags: string[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('@')) {
      pendingTags.push(...line.split(/\s+/).filter((t) => t.startsWith('@')));
      return;
    }
    if (/^Feature:/.test(line)) {
      out.featureLine = i + 1;
      out.tags = pendingTags;
      pendingTags = [];
    } else if (/^Scenario( Outline| Template)?:/.test(line)) {
      out.scenarios.push({
        line: i + 1,
        name: line.replace(/^Scenario( Outline| Template)?:\s*/, ''),
        tags: pendingTags,
        outline: /Outline|Template/.test(line),
      });
      pendingTags = [];
    } else if (line && !line.startsWith('#')) {
      pendingTags = [];
    }
  });
  return out;
}

/** Find the scenario whose block contains a 1-based line. */
export function scenarioAtLine(parsed: ParsedFeature, line: number) {
  let found: ParsedFeature['scenarios'][number] | undefined;
  for (const s of parsed.scenarios) if (s.line <= line) found = s;
  return found;
}
