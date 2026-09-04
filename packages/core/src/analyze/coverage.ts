import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, sep } from 'node:path';
import * as Gherkin from '@cucumber/gherkin';
import * as Messages from '@cucumber/messages';
import { parse as parseYaml } from 'yaml';
import type { CoverageReport, CoverageRow, CoverageScenarioRef } from '@automax/contracts';
import type { ProjectRegistry } from '../config/registry.js';

export interface CoverageOptions {
  /** also read endpoints from the env's OpenAPI spec (path relative to project root or absolute) */
  openapi?: boolean | string;
  env?: string;
}

interface PickleInfo {
  feature: string;
  scenario: string;
  tags: string[];
  suite?: string;
  steps: string[];
}

function walk(dir: string, ext: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, ext, acc);
    else if (name.endsWith(ext)) acc.push(abs);
  }
  return acc;
}

/** Parse every feature into pickles (effective tags, step texts). */
export function parseFeatures(projectRoot: string, suites: string[]): PickleInfo[] {
  const featuresDir = join(projectRoot, 'features');
  const out: PickleInfo[] = [];
  const uuid = Messages.IdGenerator.uuid();
  for (const file of walk(featuresDir, '.feature')) {
    const rel = relative(projectRoot, file).split(sep).join('/');
    const text = readFileSync(file, 'utf8');
    let envelopes: readonly Messages.Envelope[];
    try {
      envelopes = Gherkin.generateMessages(
        text,
        rel,
        Messages.SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN,
        {
          includeSource: false,
          includeGherkinDocument: true,
          includePickles: true,
          newId: uuid,
        },
      );
    } catch {
      continue;
    }
    for (const env of envelopes) {
      const pickle = env.pickle;
      if (!pickle) continue;
      const tags = pickle.tags.map((t) => t.name);
      out.push({
        feature: rel,
        scenario: pickle.name,
        tags,
        suite: tags.find((t) => suites.includes(t)),
        steps: pickle.steps.map((s) => s.text),
      });
    }
  }
  return out;
}

/** Step patterns declared on page objects that call goto('<route>') — maps step text regexes to route names. */
export function pomRouteSteps(projectRoot: string): Array<{ re: RegExp; route: string }> {
  const out: Array<{ re: RegExp; route: string }> = [];
  for (const file of walk(join(projectRoot, 'pages'), '.ts')) {
    const text = readFileSync(file, 'utf8');
    const decorators = [
      ...text.matchAll(
        /@(Given|When|Then|Step)\(\s*['"`]([^'"`]+)['"`]\s*\)[\s\S]*?\{([\s\S]*?)\n\s*\}/g,
      ),
    ];
    for (const m of decorators) {
      const body = m[3] ?? '';
      const goto = /\.goto\(\s*['"`]([^'"`]+)['"`]/.exec(body);
      if (!goto) continue;
      const pattern = m[2]!
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\{string\\\}/g, '"[^"]*"')
        .replace(/\\\{int\\\}/g, '\\d+')
        .replace(/\\\{word\\\}/g, '\\S+')
        .replace(/\\\{[a-z]+\\\}/g, '.+?');
      out.push({ re: new RegExp(`^${pattern}$`), route: goto[1]! });
    }
  }
  return out;
}

function endpointMatcher(template: string): RegExp {
  const escaped = template
    .replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${escaped}/?$`);
}

function normalizeApiPath(raw: string, apiBase?: string): string {
  let p = raw.trim();
  if (apiBase && p.startsWith(apiBase)) p = p.slice(apiBase.length);
  p = p.replace(/^https?:\/\/[^/]+/, '');
  p = p.split('?')[0]!;
  p = p.replace(/\{\{[^}]+\}\}/g, '1');
  return p.startsWith('/') ? p : `/${p}`;
}

function openapiEndpoints(projectRoot: string, specPath: string): string[] {
  const abs = resolvePath(projectRoot, specPath);
  if (!existsSync(abs)) return [];
  try {
    const text = readFileSync(abs, 'utf8');
    const doc = abs.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
    return Object.keys(doc?.paths ?? {});
  } catch {
    return [];
  }
}

/** Route / endpoint / role coverage of a project's scenarios, split by suite tag. */
export function computeCoverage(
  registry: ProjectRegistry,
  slug: string,
  opts: CoverageOptions = {},
): CoverageReport {
  const entry = registry.entry(slug);
  const cfg = entry.config;
  const suites = cfg.tags.suites.map((s) => `@${s}`);
  const pickles = parseFeatures(entry.root, suites);
  const routeSteps = pomRouteSteps(entry.root);

  const routeTargets = new Map<string, { path: string; module?: string }>();
  for (const [name, path] of Object.entries(cfg.routes)) routeTargets.set(name, { path });
  for (const m of cfg.modules) {
    for (const r of m.routes) {
      const existing = routeTargets.get(r);
      routeTargets.set(r, { path: existing?.path ?? cfg.routes[r] ?? `/${r}`, module: m.name });
    }
  }
  const endpointTargets = new Map<string, { module?: string }>();
  for (const m of cfg.modules)
    for (const e of m.endpoints) endpointTargets.set(e, { module: m.name });
  if (opts.openapi) {
    let spec: string | undefined = typeof opts.openapi === 'string' ? opts.openapi : undefined;
    if (!spec) {
      try {
        spec = registry.resolve(slug, opts.env, {}, { ...process.env }).env.api.openapi;
      } catch {
        spec = undefined;
      }
    }
    if (spec)
      for (const p of openapiEndpoints(entry.root, spec))
        if (!endpointTargets.has(p)) endpointTargets.set(p, {});
  }
  const roleTargets = cfg.tags.roles;
  let apiBase: string | undefined;
  try {
    apiBase = registry.resolve(slug, opts.env, {}, { ...process.env }).env.api.baseUrl;
  } catch {
    apiBase = undefined;
  }

  const routeRows = new Map<string, CoverageRow>();
  for (const [name, t] of routeTargets)
    routeRows.set(name, {
      kind: 'route',
      name,
      target: t.path,
      module: t.module,
      covered: false,
      scenarios: [],
      bySuite: {},
    });
  const endpointRows = new Map<string, CoverageRow>();
  for (const [tpl, t] of endpointTargets)
    endpointRows.set(tpl, {
      kind: 'endpoint',
      name: tpl,
      target: tpl,
      module: t.module,
      covered: false,
      scenarios: [],
      bySuite: {},
    });
  const roleRows = new Map<string, CoverageRow>();
  for (const r of roleTargets)
    roleRows.set(r, {
      kind: 'role',
      name: r,
      target: `@user:${r}`,
      covered: false,
      scenarios: [],
      bySuite: {},
    });
  const endpointMatchers = [...endpointTargets.keys()].map((tpl) => ({
    tpl,
    re: endpointMatcher(tpl),
  }));

  const bySuite: Record<string, number> = {};
  const addHit = (row: CoverageRow | undefined, ref: CoverageScenarioRef) => {
    if (!row) return;
    if (row.scenarios.some((s) => s.feature === ref.feature && s.scenario === ref.scenario)) return;
    row.covered = true;
    row.scenarios.push(ref);
    const suite = ref.suite ?? '(untagged)';
    row.bySuite[suite] = (row.bySuite[suite] ?? 0) + 1;
  };

  for (const p of pickles) {
    const ref: CoverageScenarioRef = {
      feature: p.feature,
      scenario: p.scenario,
      suite: p.suite,
      tags: p.tags,
    };
    bySuite[p.suite ?? '(untagged)'] = (bySuite[p.suite ?? '(untagged)'] ?? 0) + 1;
    for (const step of p.steps) {
      const nav = /^I (?:navigate to|am on|open|go to) the "([^"]+)" page$/.exec(step);
      if (nav) addHit(routeRows.get(nav[1]!), ref);
      const plain = /^I (?:am on|should be on|open|navigate to|go to) the ([a-z0-9-]+) page$/.exec(
        step,
      );
      if (plain) addHit(routeRows.get(plain[1]!), ref);
      for (const rs of routeSteps) if (rs.re.test(step)) addHit(routeRows.get(rs.route), ref);
      const req =
        /request to "([^"]+)"/.exec(step) ?? /I (?:seed|poll) (?:via )?[A-Z]+ "([^"]+)"/.exec(step);
      if (req) {
        const path = normalizeApiPath(req[1]!, apiBase);
        for (const m of endpointMatchers) if (m.re.test(path)) addHit(endpointRows.get(m.tpl), ref);
      }
      const lease = /leased user with role "([^"]+)"/.exec(step);
      if (lease) addHit(roleRows.get(lease[1]!), ref);
    }
    for (const t of p.tags) {
      const m = /^@user:(.+)$/.exec(t);
      if (m) addHit(roleRows.get(m[1]!), ref);
    }
  }

  const routes = [...routeRows.values()];
  const endpoints = [...endpointRows.values()];
  const roles = [...roleRows.values()];
  const uncoveredModules = cfg.modules
    .filter((m) => {
      const rows = [
        ...routes.filter((r) => r.module === m.name),
        ...endpoints.filter((r) => r.module === m.name),
      ];
      return rows.length > 0 && rows.every((r) => !r.covered);
    })
    .map((m) => m.name);
  return {
    project: slug,
    generatedAt: new Date().toISOString(),
    suites,
    routes,
    endpoints,
    roles,
    summary: {
      routes: { covered: routes.filter((r) => r.covered).length, total: routes.length },
      endpoints: { covered: endpoints.filter((r) => r.covered).length, total: endpoints.length },
      roles: { covered: roles.filter((r) => r.covered).length, total: roles.length },
      scenarios: pickles.length,
      bySuite,
      uncoveredModules,
    },
  };
}
