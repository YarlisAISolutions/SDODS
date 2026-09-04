import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';
import { SdodsCliError, sdodsCli, cliOrNote } from '../cli.js';
import { projectRoot, readYaml, safeJoin, walk } from '../fs.js';
import { ProposalStore } from '../proposals.js';
import { defineTool, summarize } from '../registry/registry.js';

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

function suitesOf(root: string): string[] {
  const yaml = readYaml<{ tags?: { suites?: string[] } }>(join(root, 'sdods.project.yaml'));
  return (yaml?.tags?.suites ?? ['smoke', 'regression', 'sanity']).map((s) => `@${s}`);
}

function featureFiles(root: string): string[] {
  const dir = join(root, 'features');
  return walk(dir, (f) => f.endsWith('.feature')).map((f) => relative(root, f).replace(/\\/g, '/'));
}

export const featureTools = [
  defineTool({
    name: 'feature_list',
    title: 'List features',
    description:
      'Feature files of a project with their tags, scenario counts and module directory.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const files = featureFiles(root).map((rel) => {
        const parsed = parseGherkin(readFileSync(join(root, rel), 'utf8'), rel);
        const module =
          rel.split('/')[1] && rel.split('/').length > 2 ? rel.split('/')[1] : undefined;
        return {
          path: rel,
          module,
          name: parsed.name,
          tags: parsed.tags,
          scenarios: parsed.scenarios.length,
          errors: parsed.errors,
        };
      });
      return {
        text: summarize(`Features of ${args.project} (${files.length})`, files),
        data: files,
      };
    },
  }),
  defineTool({
    name: 'feature_read',
    title: 'Read feature',
    description:
      'Read a feature file (path relative to the project, e.g. features/auth/login.feature).',
    shape: { project: z.string(), path: z.string() },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const file = safeJoin(join(root, 'features'), args.path.replace(/^features\//, ''));
      if (!existsSync(file))
        throw Object.assign(new Error(`No such feature: ${args.path}`), {
          error: { code: 'NOT_FOUND' },
        });
      const text = readFileSync(file, 'utf8');
      return { text: `\`\`\`gherkin\n${text}\n\`\`\``, data: { path: args.path, text } };
    },
  }),
  defineTool({
    name: 'feature_parse',
    title: 'Parse feature',
    description:
      'Parse Gherkin text (or a project feature path) into tags, scenarios and steps; reports syntax errors.',
    shape: {
      text: z.string().optional().describe('Gherkin source'),
      project: z.string().optional(),
      path: z
        .string()
        .optional()
        .describe('feature path relative to the project (alternative to text)'),
    },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      let text = args.text;
      let path = args.path ?? 'inline.feature';
      if (!text && args.project && args.path) {
        const root = projectRoot(ctx.rootDir, args.project);
        text = readFileSync(
          safeJoin(join(root, 'features'), args.path.replace(/^features\//, '')),
          'utf8',
        );
        path = args.path;
      }
      if (!text)
        throw Object.assign(new Error('Pass text, or project + path'), {
          error: { code: 'INVALID_ARGS' },
        });
      const parsed = parseGherkin(text, path);
      const suites = args.project
        ? suitesOf(projectRoot(ctx.rootDir, args.project))
        : ['@smoke', '@regression', '@sanity'];
      const problems = parsed.errors.length ? [] : basicTagCheck(parsed, suites);
      return {
        text: summarize(`Parsed ${path}`, { ...parsed, tagProblems: problems }),
        data: { ...parsed, tagProblems: problems },
      };
    },
  }),
  defineTool({
    name: 'feature_lint',
    title: 'Lint features',
    description:
      'Run sdods lint for a project: Gherkin syntax, tag taxonomy, module rules, undefined steps.',
    shape: { project: z.string() },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      try {
        const r = await sdodsCli(['lint', '-p', args.project], {
          cwd: ctx.rootDir,
          signal: ctx.signal,
          timeoutMs: 120_000,
        });
        return {
          text: summarize(`Lint ${args.project}: clean`, r.json),
          data: r.json ?? { errors: [], warnings: [] },
        };
      } catch (e) {
        if (e instanceof SdodsCliError) {
          if (e.notSupported)
            return {
              text: 'sdods lint is not available in this build; falling back to basic checks.',
              data: await basicLint(ctx.rootDir, args.project),
            };
          const m = /\{[\s\S]*\}/.exec(e.stderr) ?? /\{[\s\S]*\}/.exec(e.message);
          const data = m ? safeJson(m[0]) : { error: e.error };
          return {
            text: summarize(`Lint ${args.project}: problems found`, data),
            data,
            isError: true,
          };
        }
        throw e;
      }
    },
  }),
  defineTool({
    name: 'feature_write',
    title: 'Propose a feature file',
    description:
      'Validate Gherkin and stage it as a proposal (proposals/<id>/files/projects/<slug>/features/<path>). Never writes to the working tree; a person accepts the proposal.',
    shape: {
      project: z.string(),
      path: z.string().describe('relative to the project features dir, e.g. auth/login.feature'),
      text: z.string(),
      summary: z.string().optional(),
      extraFiles: z
        .array(
          z.object({
            path: z.string().describe('relative to the project root, e.g. steps/auth.steps.ts'),
            content: z.string(),
          }),
        )
        .optional()
        .describe('companion step definitions or page objects'),
    },
    access: 'write',
    domain: 'features',
    capability: 'core',
    annotations: { destructiveHint: false },
    handler: async (args, ctx) => {
      const root = projectRoot(ctx.rootDir, args.project);
      const parsed = parseGherkin(args.text, args.path);
      if (parsed.errors.length)
        return {
          text: `Gherkin errors:\n${parsed.errors.join('\n')}`,
          data: { errors: parsed.errors },
          isError: true,
        };
      const problems = basicTagCheck(parsed, suitesOf(root));
      if (problems.length)
        return {
          text: `Tag policy violations:\n${problems.join('\n')}`,
          data: { errors: problems },
          isError: true,
        };
      const projectRel = relative(ctx.rootDir, root).replace(/\\/g, '/');
      const files = [
        {
          path: `${projectRel}/features/${args.path.replace(/^features\//, '')}`,
          content: args.text,
        },
        ...(args.extraFiles ?? []).map((f) => ({
          path: `${projectRel}/${f.path}`,
          content: f.content,
        })),
      ];
      const store = new ProposalStore(ctx.rootDir);
      const manifest = store.create({
        role: 'mcp',
        project: args.project,
        summary: args.summary ?? `Feature ${args.path} (${parsed.scenarios.length} scenarios)`,
        files,
      });
      return {
        text: `Proposal ${manifest.id} created with ${files.length} file(s). Review with proposal_get and apply with proposal_accept.`,
        data: manifest,
      };
    },
  }),
  defineTool({
    name: 'step_list',
    title: 'List step definitions',
    description: 'Step patterns available to a project (core library + project steps).',
    shape: { project: z.string() },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const data = await cliOrNote<unknown[]>(['steps', 'list', '-p', args.project], {
        cwd: ctx.rootDir,
        signal: ctx.signal,
        timeoutMs: 120_000,
      });
      return { text: summarize(`Steps for ${args.project}`, data), data };
    },
  }),
  defineTool({
    name: 'step_find',
    title: 'Find matching steps',
    description:
      'Fuzzy-match a phrase against the step patterns of a project to reuse existing steps.',
    shape: {
      project: z.string(),
      phrase: z.string(),
      limit: z.number().int().positive().max(50).optional(),
    },
    access: 'read',
    domain: 'features',
    capability: 'core',
    handler: async (args, ctx) => {
      const data = await cliOrNote<Array<{ pattern: string; keyword?: string; file?: string }>>(
        ['steps', 'list', '-p', args.project],
        { cwd: ctx.rootDir, signal: ctx.signal, timeoutMs: 120_000 },
      );
      if (!Array.isArray(data)) return { text: 'Step list unavailable in this build.', data };
      const scored = data
        .map((s) => ({ ...s, score: similarity(args.phrase, s.pattern) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, args.limit ?? 10);
      return { text: summarize(`Closest steps to "${args.phrase}"`, scored), data: scored };
    },
  }),
];

async function basicLint(rootDir: string, project: string) {
  const root = projectRoot(rootDir, project);
  const suites = suitesOf(root);
  const errors: string[] = [];
  for (const rel of featureFiles(root)) {
    const parsed = parseGherkin(readFileSync(join(root, rel), 'utf8'), rel);
    errors.push(...parsed.errors.map((e) => `${rel}: ${e}`), ...basicTagCheck(parsed, suites));
  }
  return { errors, warnings: [] };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
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
