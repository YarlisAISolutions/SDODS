/**
 * A small Gherkin reader for the documentation playground.
 *
 * It reads the same subset of the language the SDODS runner reads — tags, a feature, scenarios,
 * steps and docstrings — so a scenario a reader edits here is a scenario they can paste into
 * `projects/<slug>/features/…` unchanged. It does not implement outlines, backgrounds or rules;
 * the playground scenarios do not use them, and pretending otherwise would teach the wrong thing.
 */

export type Keyword = 'Given' | 'When' | 'Then' | 'And' | 'But';

export interface ParsedStep {
  keyword: Keyword;
  text: string;
  docString?: string;
  docStringType?: string;
  line: number;
}

export interface ParsedScenario {
  name: string;
  tags: string[];
  steps: ParsedStep[];
  line: number;
}

export interface ParsedFeature {
  name: string;
  tags: string[];
  description: string[];
  scenarios: ParsedScenario[];
  errors: string[];
}

const KEYWORDS: Keyword[] = ['Given', 'When', 'Then', 'And', 'But'];

const LAYER_TAGS = ['@ui', '@api', '@hybrid'];
const SUITE_TAGS = ['@smoke', '@regression', '@sanity'];

/** Splits a tag line into tags, tolerating the `@a @b` and `@a@b` spellings people type. */
function readTags(line: string): string[] {
  return line
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith('@'));
}

export function parseFeature(source: string): ParsedFeature {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const feature: ParsedFeature = {
    name: '',
    tags: [],
    description: [],
    scenarios: [],
    errors: [],
  };

  let pendingTags: string[] = [];
  let current: ParsedScenario | null = null;
  let lastStep: ParsedStep | null = null;
  let docLines: string[] | null = null;
  let docType = '';
  let docIndent = 0;
  let seenFeature = false;

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const number = index + 1;

    // Inside a docstring everything is content until the closing fence.
    if (docLines) {
      if (trimmed.startsWith('"""')) {
        if (lastStep) {
          lastStep.docString = docLines.join('\n');
          lastStep.docStringType = docType;
        }
        docLines = null;
        docType = '';
        return;
      }
      docLines.push(raw.slice(Math.min(docIndent, raw.length - raw.trimStart().length)));
      return;
    }

    if (trimmed === '' || trimmed.startsWith('#')) return;

    if (trimmed.startsWith('@')) {
      pendingTags = pendingTags.concat(readTags(trimmed));
      return;
    }

    if (trimmed.startsWith('"""')) {
      docLines = [];
      docType = trimmed.slice(3).trim();
      docIndent = raw.length - raw.trimStart().length;
      return;
    }

    const featureMatch = /^Feature:\s*(.*)$/.exec(trimmed);
    if (featureMatch) {
      feature.name = featureMatch[1] ?? '';
      feature.tags = pendingTags;
      pendingTags = [];
      seenFeature = true;
      current = null;
      return;
    }

    const scenarioMatch = /^(Scenario|Example):\s*(.*)$/.exec(trimmed);
    if (scenarioMatch) {
      current = { name: scenarioMatch[2] ?? '', tags: pendingTags, steps: [], line: number };
      pendingTags = [];
      feature.scenarios.push(current);
      lastStep = null;
      return;
    }

    if (/^(Scenario Outline|Background|Rule):/.test(trimmed)) {
      feature.errors.push(
        `Line ${number}: the playground reads plain scenarios only — ${trimmed.split(':')[0]} runs in the CLI, not here.`,
      );
      return;
    }

    const keyword = KEYWORDS.find((k) => trimmed.startsWith(`${k} `));
    if (keyword) {
      if (!current) {
        feature.errors.push(`Line ${number}: a step appears before any Scenario.`);
        return;
      }
      lastStep = { keyword, text: trimmed.slice(keyword.length + 1).trim(), line: number };
      current.steps.push(lastStep);
      return;
    }

    if (seenFeature && !current) {
      feature.description.push(trimmed);
      return;
    }

    feature.errors.push(
      `Line ${number}: "${trimmed}" is not a tag, a Feature, a Scenario or a step.`,
    );
  });

  if (!seenFeature) feature.errors.push('No Feature: line — every file starts with one.');
  if (feature.scenarios.length === 0) feature.errors.push('No Scenario: line — nothing to run.');
  return feature;
}

export interface LintFinding {
  level: 'error' | 'warning';
  message: string;
}

/**
 * The tag rule `sdods lint` enforces: exactly one layer tag and exactly one suite tag per
 * scenario, counting the tags the scenario inherits from its feature.
 */
export function lintTags(feature: ParsedFeature, scenario: ParsedScenario): LintFinding[] {
  const tags = [...feature.tags, ...scenario.tags];
  const findings: LintFinding[] = [];
  const layers = tags.filter((t) => LAYER_TAGS.includes(t));
  const suites = tags.filter((t) => SUITE_TAGS.includes(t));

  if (layers.length === 0)
    findings.push({
      level: 'error',
      message: 'No layer tag. Add exactly one of @ui, @api, @hybrid.',
    });
  else if (layers.length > 1)
    findings.push({
      level: 'error',
      message: `Two layer tags (${layers.join(', ')}). A scenario runs on exactly one layer.`,
    });

  if (suites.length === 0)
    findings.push({
      level: 'error',
      message: 'No suite tag. Add exactly one of @smoke, @regression, @sanity.',
    });
  else if (suites.length > 1)
    findings.push({
      level: 'error',
      message: `Two suite tags (${suites.join(', ')}). A scenario belongs to exactly one suite.`,
    });

  return findings;
}

export function layerOf(
  feature: ParsedFeature,
  scenario: ParsedScenario,
): 'ui' | 'api' | 'hybrid' | null {
  const tags = [...feature.tags, ...scenario.tags];
  if (tags.includes('@hybrid')) return 'hybrid';
  if (tags.includes('@api')) return 'api';
  if (tags.includes('@ui')) return 'ui';
  return null;
}
