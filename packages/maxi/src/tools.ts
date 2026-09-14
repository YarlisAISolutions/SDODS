import { readFileSync } from 'node:fs';
import type Anthropic from '@anthropic-ai/sdk';
import { basicTagCheck, parseGherkin, similarity } from '@sdods/mcp/gherkin';

export interface StepDef {
  keyword: string;
  pattern: string;
  source: string;
}

/** Suite tags from the demo-shop project, which is what Maxi's examples are written against. */
export const SUITE_TAGS = ['@smoke', '@regression', '@sanity'];

export function loadSteps(file: string): StepDef[] {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (s): s is StepDef =>
            typeof s === 'object' && s !== null && typeof (s as StepDef).pattern === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

const PARAM: Record<string, string> = {
  string: `(?:"[^"]*"|'[^']*')`,
  int: '-?\\d+',
  float: '-?\\d*\\.?\\d+',
  word: '[^\\s]+',
  '': '.*',
};

const escape = (s: string) => s.replace(/[.*+?^$|()[\]{}\\]/g, '\\$&');

/**
 * A Cucumber expression as a RegExp: {string}/{int}/{float}/{word}/{}, optional text "(s)" and
 * word alternation "is/are". An Outline placeholder such as <user> in the step text matches any
 * parameter, quoted or not.
 */
export function expressionToRegExp(pattern: string): RegExp {
  let out = '';
  const placeholder = `(?:"?<[^>]+>"?)`;
  for (const token of pattern.split(/(\{[^}]*\}|\([^)]*\)|\s+)/).filter((t) => t !== '')) {
    const param = /^\{([^}]*)\}$/.exec(token);
    if (param) {
      out += `(?:${PARAM[param[1]!] ?? '.+'}|${placeholder})`;
    } else if (/^\([^)]*\)$/.test(token)) {
      out += `(?:${escape(token.slice(1, -1))})?`;
    } else if (/^\s+$/.test(token)) {
      out += '\\s+';
    } else if (token.includes('/')) {
      out += `(?:${token.split('/').map(escape).join('|')})`;
    } else {
      out += escape(token);
    }
  }
  return new RegExp(`^${out}$`);
}

export class StepCatalog {
  private readonly compiled: Array<{ def: StepDef; re: RegExp }>;

  constructor(readonly steps: StepDef[]) {
    this.compiled = steps.flatMap((def) => {
      try {
        return [{ def, re: expressionToRegExp(def.pattern) }];
      } catch {
        return [];
      }
    });
  }

  find(query: string, limit = 8): Array<StepDef & { score: number }> {
    return this.steps
      .map((s) => ({ ...s, score: similarity(query, s.pattern) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  matches(text: string): boolean {
    return this.compiled.some(({ re }) => re.test(text));
  }
}

export interface ValidationReport {
  valid: boolean;
  scenarios: number;
  syntaxErrors: string[];
  tagProblems: string[];
  /** Steps with no match in the demo-shop catalog: new steps that need a definition. */
  stepsNotInCatalog: string[];
}

export function validateFeature(text: string, catalog: StepCatalog): ValidationReport {
  const parsed = parseGherkin(text, 'feature');
  const tagProblems = parsed.errors.length ? [] : basicTagCheck(parsed, SUITE_TAGS);
  const seen = new Set<string>();
  const stepsNotInCatalog: string[] = [];
  if (catalog.steps.length) {
    const texts = [
      ...(parsed.background?.steps.map((s) => s.replace(/^\S+\s+/, '')) ?? []),
      ...parsed.scenarios.flatMap((sc) => sc.steps.map((s) => s.text)),
    ];
    for (const t of texts) {
      if (seen.has(t) || catalog.matches(t)) continue;
      seen.add(t);
      stepsNotInCatalog.push(t);
    }
  }
  const noScenarios = !parsed.errors.length && parsed.scenarios.length === 0;
  return {
    valid: parsed.errors.length === 0 && tagProblems.length === 0 && !noScenarios,
    scenarios: parsed.scenarios.length,
    syntaxErrors: noScenarios ? ['The feature has no scenarios'] : parsed.errors,
    tagProblems,
    stepsNotInCatalog,
  };
}

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_steps',
    description:
      'Search the step definitions of demo-shop, the example project the SDODS docs teach with, for phrasing to reuse. Call it with what a step needs to do, e.g. "log in with a username and password" or "response status should be". Returns the closest patterns with their keyword; reuse a pattern verbatim, filling {string} with a quoted value and {int} with a number.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the step needs to do, in plain words.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'validate_feature',
    description:
      'Check a complete Gherkin feature file before showing it: syntax, exactly one layer tag (@ui/@api/@hybrid) and one suite tag (@smoke/@regression/@sanity) per scenario, and which steps have no existing definition. Pass the whole file, tags and Feature line included.',
    input_schema: {
      type: 'object',
      properties: {
        feature: { type: 'string', description: 'The full feature file text.' },
      },
      required: ['feature'],
      additionalProperties: false,
    },
    strict: true,
  },
];

/** Runs a tool call from Claude. Returns the text for the tool_result and whether it failed. */
export function runTool(
  name: string,
  input: unknown,
  catalog: StepCatalog,
): { content: string; isError: boolean } {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  if (name === 'find_steps' && typeof args.query === 'string') {
    if (!catalog.steps.length) {
      return {
        content:
          'The step catalog is unavailable right now; say so rather than guessing step phrasing.',
        isError: true,
      };
    }
    const hits = catalog.find(args.query);
    return {
      content: hits.length
        ? hits.map((s) => `${s.keyword} ${s.pattern}  (${s.source})`).join('\n')
        : 'No existing step is close. Write a new step in the same style and say it is new.',
      isError: false,
    };
  }
  if (name === 'validate_feature' && typeof args.feature === 'string') {
    return {
      content: JSON.stringify(validateFeature(args.feature, catalog), null, 2),
      isError: false,
    };
  }
  return { content: `Unknown tool or bad input for ${name}`, isError: true };
}
