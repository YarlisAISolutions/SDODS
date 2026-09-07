import { basename, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  AnalysisReport,
  DetectedFramework,
  DetectedOpenApi,
  DetectedRoute,
  DetectedTests,
  Evidence,
} from '@sdods/contracts';
import type { Scan, ScannedFile } from './scan.js';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);
const TEMPLATE_EXT = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.html', '.htm', '.ts', '.js']);

function ev(file: string, line?: number, snippet?: string): Evidence {
  return { file, line, snippet: snippet?.trim().slice(0, 160) };
}

// ── package manager / monorepo ────────────────────────────────────────────────

type PmName = AnalysisReport['packageManager']['name'];

export function detectPackageManager(scan: Scan): AnalysisReport['packageManager'] {
  const evidence: Evidence[] = [];
  let name: PmName = 'unknown';
  const root = scan.json('package.json');
  const pm = typeof root?.packageManager === 'string' ? (root.packageManager as string) : '';
  if (pm) {
    const m = /^(npm|pnpm|yarn|bun)@/.exec(pm);
    if (m) {
      name = m[1] as PmName;
      evidence.push(ev('package.json', undefined, `packageManager: ${pm}`));
    }
  }
  const lockfiles: Array<[string, PmName]> = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  for (const [file, pmName] of lockfiles) {
    if (scan.has(file)) {
      if (name === 'unknown') name = pmName;
      evidence.push(ev(file));
    }
  }
  if (name === 'unknown') {
    if (scan.has('pom.xml')) {
      name = 'maven';
      evidence.push(ev('pom.xml'));
    } else if (scan.has('build.gradle') || scan.has('build.gradle.kts')) {
      name = 'gradle';
      evidence.push(ev('build.gradle'));
    } else if (scan.has('requirements.txt') || scan.has('pyproject.toml')) {
      name = 'pip';
      evidence.push(ev(scan.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt'));
    }
  }
  const workspaces: string[] = [];
  if (Array.isArray(root?.workspaces)) workspaces.push(...root.workspaces.map(String));
  else if (root?.workspaces?.packages) workspaces.push(...root.workspaces.packages.map(String));
  const pnpmWs = scan.read('pnpm-workspace.yaml');
  if (pnpmWs) {
    try {
      const parsed = parseYaml(pnpmWs) as { packages?: string[] };
      if (parsed?.packages) workspaces.push(...parsed.packages);
    } catch {
      /* ignore */
    }
  }
  for (const f of ['lerna.json', 'nx.json', 'turbo.json', 'pnpm-workspace.yaml']) {
    if (scan.has(f)) evidence.push(ev(f, undefined, 'monorepo tooling'));
  }
  const monorepo =
    workspaces.length > 0 ||
    scan.has('lerna.json') ||
    scan.has('nx.json') ||
    scan.has('turbo.json');
  return { name, monorepo, workspaces: [...new Set(workspaces)], evidence };
}

// ── frameworks ────────────────────────────────────────────────────────────────

const FRAMEWORK_DEPS: Array<{
  dep: string;
  name: string;
  kind: DetectedFramework['kind'];
  weight: number;
}> = [
  { dep: 'next', name: 'Next.js', kind: 'fullstack', weight: 0.95 },
  { dep: 'nuxt', name: 'Nuxt', kind: 'fullstack', weight: 0.95 },
  { dep: '@remix-run/react', name: 'Remix', kind: 'fullstack', weight: 0.9 },
  { dep: '@sveltejs/kit', name: 'SvelteKit', kind: 'fullstack', weight: 0.9 },
  { dep: '@angular/core', name: 'Angular', kind: 'frontend', weight: 0.95 },
  { dep: 'react-router-dom', name: 'React Router', kind: 'frontend', weight: 0.8 },
  { dep: 'react-router', name: 'React Router', kind: 'frontend', weight: 0.7 },
  { dep: 'vue-router', name: 'Vue Router', kind: 'frontend', weight: 0.8 },
  { dep: 'vue', name: 'Vue', kind: 'frontend', weight: 0.6 },
  { dep: 'react', name: 'React', kind: 'frontend', weight: 0.5 },
  { dep: 'svelte', name: 'Svelte', kind: 'frontend', weight: 0.6 },
  { dep: 'react-native', name: 'React Native', kind: 'mobile', weight: 0.9 },
  { dep: 'express', name: 'Express', kind: 'backend', weight: 0.9 },
  { dep: 'fastify', name: 'Fastify', kind: 'backend', weight: 0.9 },
  { dep: '@nestjs/core', name: 'NestJS', kind: 'backend', weight: 0.95 },
  { dep: 'koa', name: 'Koa', kind: 'backend', weight: 0.85 },
  { dep: '@hapi/hapi', name: 'Hapi', kind: 'backend', weight: 0.85 },
  { dep: 'hono', name: 'Hono', kind: 'backend', weight: 0.85 },
];

export function detectFrameworks(scan: Scan): DetectedFramework[] {
  const deps = scan.dependencies();
  const found = new Map<string, DetectedFramework>();
  for (const spec of FRAMEWORK_DEPS) {
    const d = deps.get(spec.dep);
    if (!d) continue;
    const existing = found.get(spec.name);
    const entry: DetectedFramework = existing ?? {
      name: spec.name,
      kind: spec.kind,
      version: d.version,
      confidence: spec.weight,
      evidence: [],
    };
    entry.confidence = Math.max(entry.confidence, spec.weight);
    entry.evidence.push(ev(d.manifest, undefined, `${spec.dep}@${d.version}`));
    found.set(spec.name, entry);
  }
  // config files raise confidence
  const configs: Array<[RegExp, string]> = [
    [/^next\.config\.(js|mjs|ts)$/, 'Next.js'],
    [/^nuxt\.config\.(js|ts)$/, 'Nuxt'],
    [/^angular\.json$/, 'Angular'],
    [/^svelte\.config\.(js|ts)$/, 'SvelteKit'],
    [/^vite\.config\.(js|ts|mjs)$/, 'Vite'],
  ];
  for (const f of scan.files) {
    for (const [re, name] of configs) {
      if (re.test(basename(f.rel)) && f.rel.split('/').length <= 3) {
        const entry = found.get(name);
        if (entry) {
          entry.confidence = Math.min(1, entry.confidence + 0.05);
          entry.evidence.push(ev(f.rel));
        } else if (name === 'Vite') {
          found.set('Vite', {
            name: 'Vite',
            kind: 'frontend',
            confidence: 0.5,
            evidence: [ev(f.rel)],
          });
        }
      }
    }
  }
  // Python / Java backends
  const py = [
    scan.read('requirements.txt'),
    scan.read('pyproject.toml'),
    scan.read('Pipfile'),
  ].join('\n');
  for (const [dep, name] of [
    ['django', 'Django'],
    ['flask', 'Flask'],
    ['fastapi', 'FastAPI'],
  ] as const) {
    if (new RegExp(`(^|\\n|["'\\s])${dep}\\b`, 'i').test(py)) {
      found.set(name, {
        name,
        kind: 'backend',
        confidence: 0.85,
        evidence: [
          ev(scan.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt', undefined, dep),
        ],
      });
    }
  }
  const java = [
    scan.read('pom.xml'),
    scan.read('build.gradle'),
    scan.read('build.gradle.kts'),
  ].join('\n');
  if (/spring-boot/i.test(java)) {
    found.set('Spring Boot', {
      name: 'Spring Boot',
      kind: 'backend',
      confidence: 0.9,
      evidence: [ev(scan.has('pom.xml') ? 'pom.xml' : 'build.gradle', undefined, 'spring-boot')],
    });
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}

// ── routes ────────────────────────────────────────────────────────────────────

function paramsOf(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!.replace(/\*$/, ''));
}

function normalizeExpressPath(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}').replace(/\/+$/, '') || '/';
}

function nextSegmentsToPath(segments: string[]): string {
  const parts = segments
    .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@') && s !== '')
    .map((s) =>
      s
        .replace(/^\[\[\.\.\.(.+)\]\]$/, '{$1*}')
        .replace(/^\[\.\.\.(.+)\]$/, '{$1*}')
        .replace(/^\[(.+)\]$/, '{$1}'),
    );
  return '/' + parts.join('/');
}

export function detectRoutes(scan: Scan, frameworks: DetectedFramework[]): DetectedRoute[] {
  const routes: DetectedRoute[] = [];
  const names = new Set(frameworks.map((f) => f.name));
  const push = (r: DetectedRoute) => {
    if (!routes.some((x) => x.path === r.path && x.kind === r.kind && x.method === r.method))
      routes.push(r);
  };

  // Next.js app router + pages router
  if (
    names.has('Next.js') ||
    scan.files.some((f) => /(^|\/)app\/.*page\.(tsx|jsx|ts|js)$/.test(f.rel))
  ) {
    for (const f of scan.files) {
      if (isNotShippedCode(f.rel)) continue;
      const m = /(?:^|\/)(?:src\/)?app\/(.*?)(?:^|\/)?(page|route)\.(tsx|jsx|ts|js)$/.exec(f.rel);
      if (!m) continue;
      const dir = f.rel.replace(/\/?(page|route)\.(tsx|jsx|ts|js)$/, '');
      const appIdx = dir.split('/').findIndex((s) => s === 'app');
      const segs = dir.split('/').slice(appIdx + 1);
      const path = nextSegmentsToPath(segs);
      if (m[2] === 'route') {
        const methods = [
          ...scan
            .read(f.rel)
            .matchAll(
              /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g,
            ),
        ].map((x) => x[1]!);
        const list = methods.length ? methods : ['GET'];
        for (const method of list)
          push({
            path,
            kind: 'api',
            method,
            source: 'next-app-router',
            file: f.rel,
            params: paramsOf(path),
          });
      } else {
        push({
          path,
          kind: 'page',
          source: 'next-app-router',
          file: f.rel,
          params: paramsOf(path),
        });
      }
    }
    for (const f of scan.files) {
      if (isNotShippedCode(f.rel)) continue;
      const m = /(?:^|\/)(?:src\/)?pages\/(.+)\.(tsx|jsx|ts|js)$/.exec(f.rel);
      if (!m) continue;
      // A directory called `pages` is not automatically the Pages Router.
      // `app/api/intranet/pages/[id]/route.ts` is an App Router ROUTE HANDLER
      // inside a resource that happens to be named "pages" — and it was being
      // read as a Pages Router PAGE at `/{id}/route`: wrong kind, wrong source,
      // and a path that had lost every parent segment. Anything under an `app/`
      // segment belongs to the App Router loop above, which already handled it.
      if (/(?:^|\/)(?:src\/)?app\//.test(f.rel)) continue;
      const rel = m[1]!;
      if (/^_app$|^_document$|^_error$|^404$|^500$/.test(rel)) continue;
      const segs = rel.split('/').map((s) => (s === 'index' ? '' : s));
      const isApi = segs[0] === 'api';
      const path = nextSegmentsToPath(segs);
      push({
        path: path || '/',
        kind: isApi ? 'api' : 'page',
        method: isApi ? 'GET' : undefined,
        source: 'next-pages-router',
        file: f.rel,
        params: paramsOf(path),
      });
    }
  }

  /**
   * Colocated tests, stories and type declarations sit next to the code they
   * cover and match every route filename pattern. `route.test.ts` was being
   * reported as a route named `id-publish-route-test`, which then became a key in
   * the generated `routes:` map — an address that resolves to nothing.
   */
  function isNotShippedCode(rel: string): boolean {
    return /\.(test|spec|stories|story|bench|d)\.(tsx|jsx|ts|js|mts|cts)$/.test(rel);
  }

  // React Router
  if (names.has('React Router')) {
    for (const f of scan.byExt('.tsx', '.jsx', '.ts', '.js')) {
      const text = scan.read(f.rel);
      if (!/react-router|<Route\b|createBrowserRouter|createRoutesFromElements/.test(text))
        continue;
      for (const hit of scan.grep(f.rel, /<Route[^>]*\bpath=["']([^"']+)["']/)) {
        const path = normalizeExpressPath(hit.match[1]!);
        push({
          path,
          kind: 'page',
          source: 'react-router',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
      if (/createBrowserRouter|createHashRouter|useRoutes|RouteObject/.test(text)) {
        for (const hit of scan.grep(f.rel, /\bpath:\s*["']([^"']+)["']/)) {
          const path = normalizeExpressPath(
            hit.match[1]!.startsWith('/') ? hit.match[1]! : `/${hit.match[1]}`,
          );
          push({
            path,
            kind: 'page',
            source: 'react-router',
            file: f.rel,
            line: hit.line,
            params: paramsOf(path),
          });
        }
      }
    }
  }

  // Vue Router
  if (names.has('Vue Router') || names.has('Nuxt')) {
    for (const f of scan.byExt('.ts', '.js', '.vue')) {
      const text = scan.read(f.rel);
      if (!/vue-router|createRouter\(/.test(text)) continue;
      for (const hit of scan.grep(f.rel, /\bpath:\s*["']([^"']+)["']/)) {
        const path = normalizeExpressPath(hit.match[1]!);
        push({
          path,
          kind: 'page',
          source: 'vue-router',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
    for (const f of scan.files) {
      const m = /(?:^|\/)pages\/(.+)\.vue$/.exec(f.rel);
      if (!m || !names.has('Nuxt')) continue;
      const segs = m[1]!
        .split('/')
        .map((s) => (s === 'index' ? '' : s.replace(/^\[(.+)\]$/, '{$1}')));
      const path = '/' + segs.filter(Boolean).join('/');
      push({ path, kind: 'page', source: 'nuxt-pages', file: f.rel, params: paramsOf(path) });
    }
  }

  // Angular
  if (names.has('Angular')) {
    for (const f of scan.byExt('.ts')) {
      if (
        !/routes|routing/i.test(f.rel) &&
        !/RouterModule\.for(Root|Child)|provideRouter\(/.test(scan.read(f.rel))
      )
        continue;
      const text = scan.read(f.rel);
      if (!/\bpath:\s*['"]/.test(text)) continue;
      for (const hit of scan.grep(f.rel, /\bpath:\s*['"]([^'"]*)['"]/)) {
        const raw = hit.match[1]!;
        if (raw === '**') continue;
        const path = normalizeExpressPath('/' + raw.replace(/^\//, ''));
        push({
          path,
          kind: 'page',
          source: 'angular-router',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
  }

  // Express / Fastify / Koa / Hono style
  const backend = ['Express', 'Fastify', 'Koa', 'Hapi', 'Hono'].some((n) => names.has(n));
  if (backend) {
    for (const f of scan.byExt('.ts', '.js', '.mjs', '.cjs')) {
      if (/\.(spec|test)\.(ts|js)$/.test(f.rel)) continue;
      for (const hit of scan.grep(
        f.rel,
        /\b(?:app|router|server|fastify|api|route[rs]?)\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(\s*["'`]([^"'`]+)["'`]/i,
      )) {
        const path = normalizeExpressPath(hit.match[2]!);
        push({
          path,
          kind: 'api',
          method: hit.match[1]!.toUpperCase(),
          source: 'express-style',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
      for (const hit of scan.grep(
        f.rel,
        /\.route\(\s*\{[^}]*method:\s*["'`](\w+)["'`][^}]*url:\s*["'`]([^"'`]+)["'`]/,
      )) {
        const path = normalizeExpressPath(hit.match[2]!);
        push({
          path,
          kind: 'api',
          method: hit.match[1]!.toUpperCase(),
          source: 'fastify-route',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
  }

  // NestJS
  if (names.has('NestJS')) {
    for (const f of scan.byExt('.ts')) {
      const text = scan.read(f.rel);
      const ctrl = /@Controller\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/.exec(text);
      if (!ctrl) continue;
      const base = '/' + (ctrl[1] ?? '').replace(/^\//, '');
      for (const hit of scan.grep(
        f.rel,
        /@(Get|Post|Put|Patch|Delete|Head|Options)\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/,
      )) {
        const sub = hit.match[2] ? '/' + hit.match[2].replace(/^\//, '') : '';
        const path = normalizeExpressPath((base + sub).replace(/\/{2,}/g, '/'));
        push({
          path,
          kind: 'api',
          method: hit.match[1]!.toUpperCase(),
          source: 'nestjs',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
  }

  // Spring
  if (names.has('Spring Boot')) {
    for (const f of scan.byExt('.java', '.kt')) {
      const text = scan.read(f.rel);
      const cls = /@RequestMapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/.exec(text);
      const base = cls ? cls[1]! : '';
      for (const hit of scan.grep(
        f.rel,
        /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?(?:["']([^"']*)["'])?/,
      )) {
        const sub = hit.match[2] ?? '';
        const path = normalizeExpressPath(
          ((base + '/' + sub).replace(/\/{2,}/g, '/') || '/').replace(/^(?!\/)/, '/'),
        );
        push({
          path,
          kind: 'api',
          method: hit.match[1]!.toUpperCase(),
          source: 'spring',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
  }

  // Flask / FastAPI / Django
  for (const f of scan.byExt('.py')) {
    for (const hit of scan.grep(
      f.rel,
      /@(?:app|bp|blueprint|router|api)\.(route|get|post|put|patch|delete)\(\s*["']([^"']+)["'](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/,
    )) {
      const path = hit.match[2]!.replace(/<(?:\w+:)?(\w+)>/g, '{$1}');
      const verb = hit.match[1]!;
      const methods =
        verb === 'route'
          ? hit.match[3]
            ? [...hit.match[3].matchAll(/["'](\w+)["']/g)].map((m) => m[1]!.toUpperCase())
            : ['GET']
          : [verb.toUpperCase()];
      for (const method of methods)
        push({
          path,
          kind: 'api',
          method,
          source: 'python',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
    }
    if (/urls\.py$/.test(f.rel)) {
      for (const hit of scan.grep(f.rel, /\b(?:path|re_path|url)\(\s*r?["']([^"']*)["']/)) {
        const raw = hit.match[1]!.replace(/^\^/, '').replace(/\$$/, '');
        const path = '/' + raw.replace(/<(?:\w+:)?(\w+)>/g, '{$1}').replace(/\/$/, '');
        push({
          path: path || '/',
          kind: 'page',
          source: 'django-urls',
          file: f.rel,
          line: hit.line,
          params: paramsOf(path),
        });
      }
    }
  }

  return routes.sort(
    (a, b) => a.path.localeCompare(b.path) || (a.method ?? '').localeCompare(b.method ?? ''),
  );
}

// ── OpenAPI ───────────────────────────────────────────────────────────────────

export function detectOpenApi(scan: Scan, extra?: string): DetectedOpenApi[] {
  const out: DetectedOpenApi[] = [];
  const candidates = scan.files.filter(
    (f) =>
      /(openapi|swagger|api-docs|api\.spec)[^/]*\.(json|ya?ml)$/i.test(basename(f.rel)) ||
      f.rel === extra,
  );
  // also small json/yaml files that start with openapi:/swagger:
  for (const f of scan.byExt('.json', '.yaml', '.yml')) {
    if (candidates.includes(f) || f.size > 2 * 1024 * 1024) continue;
    const head = scan.read(f.rel).slice(0, 400);
    if (/^\s*[{]?\s*["']?(openapi|swagger)["']?\s*[:=]/m.test(head)) candidates.push(f);
  }
  for (const f of candidates) {
    const text = scan.read(f.rel);
    if (!text) continue;
    let doc: any;
    try {
      doc = f.ext === '.json' ? JSON.parse(text) : parseYaml(text);
    } catch {
      continue;
    }
    if (!doc || typeof doc !== 'object' || (!doc.openapi && !doc.swagger) || !doc.paths) continue;
    const endpoints: DetectedOpenApi['endpoints'] = [];
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      if (!item || typeof item !== 'object') continue;
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
        const op = item[method];
        if (!op) continue;
        endpoints.push({
          method: method.toUpperCase(),
          path,
          tag: Array.isArray(op.tags) ? op.tags[0] : undefined,
          operationId: op.operationId,
        });
      }
    }
    out.push({
      file: f.rel,
      version: String(doc.openapi ?? doc.swagger),
      title: doc.info?.title,
      endpoints,
    });
  }
  return out;
}

// ── test ids ──────────────────────────────────────────────────────────────────

const TEST_ID_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-cy',
  'data-qa',
  'data-e2e',
];

export function detectTestIds(scan: Scan): AnalysisReport['testIds'] {
  const counts: Record<string, number> = {};
  for (const f of scan.files) {
    if (!TEMPLATE_EXT.has(f.ext)) continue;
    if (
      /\.(spec|test)\.(ts|tsx|js|jsx)$/.test(f.rel) ||
      /(^|\/)(e2e|cypress|tests?|__tests__)\//.test(f.rel)
    )
      continue;
    const text = scan.read(f.rel);
    if (!text) continue;
    for (const attr of TEST_ID_ATTRS) {
      const n =
        text.split(`${attr}=`).length -
        1 +
        (text.split(`'${attr}'`).length - 1) +
        (text.split(`"${attr}"`).length - 1);
      if (n > 0) counts[attr] = (counts[attr] ?? 0) + n;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  const top = sorted[0];
  return {
    attribute: top ? top[0] : null,
    counts,
    confidence: top ? Math.min(1, top[1] / Math.max(1, total)) * (top[1] >= 5 ? 1 : 0.6) : 0,
  };
}

// ── existing tests ────────────────────────────────────────────────────────────

function countLocators(text: string): DetectedTests['locators'] {
  return {
    css:
      (text.match(/\.locator\(\s*["'`][^"'`]*["'`]/g) ?? []).filter((m) => !/xpath=|\/\//.test(m))
        .length +
      (text.match(/\bcy\.get\(/g) ?? []).length +
      (text.match(/\$\(\s*["'`]/g) ?? []).length,
    xpath:
      (text.match(/xpath=|\.locator\(\s*["'`]\/\//g) ?? []).length +
      (text.match(/cy\.xpath\(/g) ?? []).length,
    role: (text.match(/getByRole\(/g) ?? []).length + (text.match(/findByRole\(/g) ?? []).length,
    testId:
      (text.match(/getByTestId\(/g) ?? []).length +
      (text.match(/\[data-(testid|test|cy|qa)=/g) ?? []).length,
    text:
      (text.match(/getByText\(/g) ?? []).length +
      (text.match(/cy\.contains\(/g) ?? []).length +
      (text.match(/getByLabel\(/g) ?? []).length,
  };
}

export function detectExistingTests(scan: Scan): DetectedTests[] {
  const deps = scan.dependencies();
  const groups: Record<DetectedTests['framework'], ScannedFile[]> = {
    playwright: [],
    cypress: [],
    cucumber: [],
    jest: [],
    vitest: [],
    other: [],
  };
  for (const f of scan.files) {
    if (f.ext === '.feature') {
      groups.cucumber.push(f);
      continue;
    }
    if (
      !/\.(spec|test|cy|e2e)\.(ts|tsx|js|jsx|mjs)$/.test(f.rel) &&
      !/(^|\/)(e2e|cypress|__tests__)\//.test(f.rel)
    )
      continue;
    if (!SOURCE_EXT.has(f.ext)) continue;
    const text = scan.read(f.rel);
    if (/@playwright\/test|playwright-bdd|from ['"]playwright['"]/.test(text))
      groups.playwright.push(f);
    else if (/\bcy\.|from ['"]cypress['"]|\.cy\.(ts|js)$/.test(text + f.rel))
      groups.cypress.push(f);
    else if (/from ['"]vitest['"]/.test(text)) groups.vitest.push(f);
    else if (/\bjest\b|from ['"]@jest\/globals['"]/.test(text) || deps.has('jest'))
      groups.jest.push(f);
    else groups.other.push(f);
  }
  const out: DetectedTests[] = [];
  for (const [framework, files] of Object.entries(groups) as Array<
    [DetectedTests['framework'], ScannedFile[]]
  >) {
    if (!files.length) continue;
    const locators = files.reduce(
      (acc, f) => {
        const c = countLocators(scan.read(f.rel));
        for (const k of Object.keys(acc) as Array<keyof typeof acc>) acc[k] += c[k];
        return acc;
      },
      { css: 0, xpath: 0, role: 0, testId: 0, text: 0 },
    );
    out.push({
      framework,
      files: files.length,
      sampleFiles: files.slice(0, 5).map((f) => f.rel),
      locators,
    });
  }
  return out.sort((a, b) => b.files - a.files);
}

// ── auth ──────────────────────────────────────────────────────────────────────

const AUTH_LIBS: Array<{
  dep: string;
  strategy: AnalysisReport['auth']['strategyGuess'];
  weight: number;
}> = [
  { dep: 'next-auth', strategy: 'form', weight: 0.7 },
  { dep: '@auth/core', strategy: 'form', weight: 0.6 },
  { dep: 'passport', strategy: 'form', weight: 0.6 },
  { dep: 'passport-local', strategy: 'form', weight: 0.8 },
  { dep: 'express-session', strategy: 'form', weight: 0.5 },
  { dep: 'keycloak-js', strategy: 'sso', weight: 0.9 },
  { dep: '@azure/msal-browser', strategy: 'sso', weight: 0.9 },
  { dep: '@okta/okta-auth-js', strategy: 'sso', weight: 0.9 },
  { dep: 'oidc-client-ts', strategy: 'sso', weight: 0.85 },
  { dep: '@auth0/auth0-react', strategy: 'sso', weight: 0.85 },
  { dep: 'firebase', strategy: 'token', weight: 0.5 },
  { dep: 'jsonwebtoken', strategy: 'token', weight: 0.6 },
  { dep: 'jose', strategy: 'token', weight: 0.5 },
  { dep: '@nestjs/jwt', strategy: 'token', weight: 0.7 },
  { dep: 'passport-jwt', strategy: 'token', weight: 0.7 },
  { dep: 'client-oauth2', strategy: 'oauth-client-credentials', weight: 0.6 },
];

export function detectAuth(scan: Scan, routes: DetectedRoute[]): AnalysisReport['auth'] {
  const deps = scan.dependencies();
  const evidence: Evidence[] = [];
  const libraries: string[] = [];
  const votes: Record<AnalysisReport['auth']['strategyGuess'], number> = {
    none: 0,
    form: 0,
    token: 0,
    sso: 0,
    'oauth-client-credentials': 0,
  };
  for (const lib of AUTH_LIBS) {
    const d = deps.get(lib.dep);
    if (!d) continue;
    libraries.push(lib.dep);
    votes[lib.strategy] += lib.weight;
    evidence.push(ev(d.manifest, undefined, `${lib.dep}@${d.version}`));
  }
  const pages = routes
    .filter(
      (r) =>
        r.kind === 'page' &&
        /(^|\/)(login|sign-?in|auth|account\/login|signup|sign-?up|register)(\/|$)/i.test(r.path),
    )
    .map((r) => r.path);
  for (const f of scan.files) {
    if (
      /(login|signin|sign-in|auth)[^/]*\.(tsx|jsx|vue|svelte|html)$/i.test(basename(f.rel)) &&
      !pages.length
    ) {
      pages.push(f.rel);
      evidence.push(ev(f.rel, undefined, 'login-looking page file'));
    }
  }
  if (pages.length) votes.form += 0.5;
  let strategyGuess: AnalysisReport['auth']['strategyGuess'] = 'none';
  let best = 0;
  for (const [k, v] of Object.entries(votes) as Array<
    [AnalysisReport['auth']['strategyGuess'], number]
  >) {
    if (v > best) {
      best = v;
      strategyGuess = k;
    }
  }
  return {
    pages: [...new Set(pages)],
    libraries,
    strategyGuess,
    confidence: Math.min(1, best),
    evidence,
  };
}

// ── envs and base urls ────────────────────────────────────────────────────────

const URL_VAR = /(BASE_?URL|API_?URL|APP_?URL|PUBLIC_URL|SITE_URL|HOST|ORIGIN|ENDPOINT)/i;

export function detectEnvs(scan: Scan): {
  envs: AnalysisReport['envs'];
  baseUrls: AnalysisReport['baseUrls'];
} {
  const envs: AnalysisReport['envs'] = [];
  const evidence: Evidence[] = [];
  let ui: string | undefined;
  let api: string | undefined;
  for (const f of scan.files) {
    const name = basename(f.rel);
    if (!name.startsWith('.env')) continue;
    if (f.rel.split('/').length > 2) continue;
    const envName =
      name === '.env' ? 'local' : name.replace(/^\.env\.?/, '').replace(/\.local$/, '') || 'local';
    const vars: string[] = [];
    let uiBaseUrl: string | undefined;
    let apiBaseUrl: string | undefined;
    for (const hit of scan.grep(f.rel, /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)) {
      const key = hit.match[1]!;
      const raw = hit.match[2]!.trim().replace(/^["']|["']$/g, '');
      vars.push(key);
      if (URL_VAR.test(key) && /^https?:\/\//.test(raw)) {
        if (/API|ENDPOINT/i.test(key)) apiBaseUrl ??= raw;
        else uiBaseUrl ??= raw;
        evidence.push(ev(f.rel, hit.line, `${key}=${/example|sample/i.test(name) ? raw : '…'}`));
      }
    }
    envs.push({
      name: envName === 'example' || envName === 'sample' ? 'example' : envName,
      file: f.rel,
      uiBaseUrl,
      apiBaseUrl,
      vars,
    });
  }
  // dev server ports
  const portHints: Array<[string, RegExp, 'ui' | 'api']> = [
    ['vite.config.ts', /port:\s*(\d{4,5})/, 'ui'],
    ['vite.config.js', /port:\s*(\d{4,5})/, 'ui'],
    ['angular.json', /"port":\s*(\d{4,5})/, 'ui'],
    ['docker-compose.yml', /["']?(\d{4,5}):\d{2,5}["']?/, 'ui'],
    ['docker-compose.yaml', /["']?(\d{4,5}):\d{2,5}["']?/, 'ui'],
  ];
  for (const [file, re, kind] of portHints) {
    if (!scan.has(file)) continue;
    const hit = scan.grep(file, re)[0];
    if (hit) {
      const url = `http://localhost:${hit.match[1]}`;
      if (kind === 'ui') ui ??= url;
      evidence.push(ev(file, hit.line, hit.text));
    }
  }
  const pkg = scan.json('package.json');
  const scripts = JSON.stringify(pkg?.scripts ?? {});
  const portFromScripts = /(?:--port|-p|PORT=)\s*[= ]?(\d{4,5})/.exec(scripts);
  if (portFromScripts) {
    ui ??= `http://localhost:${portFromScripts[1]}`;
    evidence.push(ev('package.json', undefined, `scripts port ${portFromScripts[1]}`));
  }
  const frameworkDefaults: Array<[RegExp, string]> = [
    [/next\.config/, 'http://localhost:3000'],
    [/nuxt\.config/, 'http://localhost:3000'],
    [/angular\.json/, 'http://localhost:4200'],
    [/vite\.config/, 'http://localhost:5173'],
  ];
  for (const f of scan.files) {
    for (const [re, url] of frameworkDefaults) {
      if (re.test(basename(f.rel)) && !ui) {
        ui = url;
        evidence.push(ev(f.rel, undefined, `framework default ${url}`));
      }
    }
  }
  for (const e of envs) {
    ui ??= e.uiBaseUrl;
    api ??= e.apiBaseUrl;
  }
  const deps = scan.dependencies();
  if (!api && ['express', 'fastify', '@nestjs/core', 'koa', 'hono'].some((d) => deps.has(d))) {
    const portHit = scan.files
      .filter((f) => SOURCE_EXT.has(f.ext))
      .flatMap((f) =>
        scan.grep(f.rel, /\.listen\(\s*(?:\{[^}]*port:\s*)?(\d{4,5})/).map((h) => ({ f, h })),
      )[0];
    api = portHit ? `http://localhost:${portHit.h.match[1]}` : 'http://localhost:3000';
    if (portHit) evidence.push(ev(portHit.f.rel, portHit.h.line, portHit.h.text));
  }
  api ??= ui ? `${ui}/api` : undefined;
  return { envs, baseUrls: { ui, api, evidence } };
}

// ── CI / i18n / a11y ──────────────────────────────────────────────────────────

export function detectCi(scan: Scan): AnalysisReport['ci'] {
  const files = scan.files.map((f) => f.rel);
  const gh = files.filter((f) => f.startsWith('.github/workflows/'));
  if (gh.length) return { provider: 'github', files: gh };
  if (scan.has('.gitlab-ci.yml')) return { provider: 'gitlab', files: ['.gitlab-ci.yml'] };
  if (scan.has('.circleci/config.yml'))
    return { provider: 'circleci', files: ['.circleci/config.yml'] };
  if (scan.has('azure-pipelines.yml')) return { provider: 'azure', files: ['azure-pipelines.yml'] };
  if (scan.has('Jenkinsfile')) return { provider: 'jenkins', files: ['Jenkinsfile'] };
  if (scan.has('bitbucket-pipelines.yml'))
    return { provider: 'bitbucket', files: ['bitbucket-pipelines.yml'] };
  return { provider: 'none', files: [] };
}

export function detectI18n(scan: Scan): AnalysisReport['i18n'] {
  const deps = scan.dependencies();
  const libraries = [
    'i18next',
    'react-i18next',
    'next-intl',
    'next-i18next',
    'vue-i18n',
    '@angular/localize',
    'react-intl',
    'lingui',
    '@lingui/core',
    'svelte-i18n',
    'typesafe-i18n',
  ].filter((d) => deps.has(d));
  const locales = new Set<string>();
  for (const f of scan.files) {
    const m =
      /(?:^|\/)(?:public\/)?(?:locales|i18n|lang|translations)\/([a-z]{2}(?:-[A-Z]{2})?)(?:\/|\.json$|\.ya?ml$)/.exec(
        f.rel,
      );
    if (m) locales.add(m[1]!);
  }
  return { libraries, locales: [...locales].sort() };
}

export function detectA11y(scan: Scan): AnalysisReport['a11y'] {
  const deps = scan.dependencies();
  const tooling = [
    'axe-core',
    '@axe-core/playwright',
    '@axe-core/react',
    'cypress-axe',
    'jest-axe',
    'eslint-plugin-jsx-a11y',
    'pa11y',
    'lighthouse',
    '@lhci/cli',
    'storybook-addon-a11y',
    '@storybook/addon-a11y',
  ].filter((d) => deps.has(d));
  return { tooling };
}

export function dirOf(rel: string): string {
  return dirname(rel);
}
