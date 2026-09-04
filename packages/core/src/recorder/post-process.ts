import { Project, SyntaxKind, type SourceFile } from 'ts-morph';
import {
  formatRecordingHeader,
  RECORDING_HEADER_PREFIX,
  type RecordingMeta,
} from './recording-meta.js';

export interface PostProcessContext {
  meta: RecordingMeta;
  /** env.ui.baseUrl + env.aliases: absolute URLs on these origins become relative paths */
  baseUrls: string[];
  tags?: string[];
  /** import specifier for the merged fixtures (default '@sdods/core/test') */
  fixturesImport?: string;
}

export interface PostProcessResult {
  code: string;
  warnings: string[];
  fragileLocators: number;
  rewrittenUrls: number;
  wrapped: boolean;
}

const FRAGILE_LOCATOR_RE = /\.locator\(\s*(['"`])(#|\.|\/\/|xpath=|css=|\[|[a-z]+\s*>)/;
const DEFAULT_TAGS = ['@recorded', '@ui', '@regression'];

function origins(baseUrls: string[]): string[] {
  const out: string[] = [];
  for (const u of baseUrls) {
    try {
      out.push(new URL(u).origin);
    } catch {
      /* ignore invalid */
    }
  }
  return out;
}

function toRelative(value: string, originList: string[]): string | undefined {
  for (const origin of originList) {
    if (value === origin || value === `${origin}/`) return '/';
    if (value.startsWith(`${origin}/`)) return value.slice(origin.length);
  }
  return undefined;
}

/**
 * Rewrites a `playwright codegen --target playwright-test` file into an SDODS recorded spec:
 * fixtures import, relative URLs, `test.describe` with tags, header comment, fragile-locator markers.
 * Best effort per Playwright minor; guarded by a snapshot test against a checked-in codegen fixture.
 */
export function postProcessRecording(source: string, ctx: PostProcessContext): PostProcessResult {
  const warnings: string[] = [];
  const stripped = source
    .split(/\r?\n/)
    .filter(
      (l) =>
        !l.startsWith(RECORDING_HEADER_PREFIX) &&
        !l.startsWith('// Recorded with SDODS') &&
        !l.startsWith('// Convert to Gherkin'),
    )
    .join('\n');
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sf: SourceFile = project.createSourceFile('recording.spec.ts', stripped);

  // 1. fixtures import
  const fixturesImport = ctx.fixturesImport ?? '@sdods/core/test';
  const pwImport = sf
    .getImportDeclarations()
    .find((d) => d.getModuleSpecifierValue() === '@playwright/test');
  if (pwImport) pwImport.setModuleSpecifier(fixturesImport);
  else if (
    !sf.getImportDeclarations().some((d) => d.getModuleSpecifierValue() === fixturesImport)
  ) {
    sf.insertImportDeclaration(0, {
      namedImports: ['test', 'expect'],
      moduleSpecifier: fixturesImport,
    });
    warnings.push('No @playwright/test import found; added the SDODS fixtures import.');
  }

  // 2. absolute URLs on known origins → relative
  const originList = origins(ctx.baseUrls);
  let rewrittenUrls = 0;
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const rel = toRelative(lit.getLiteralValue(), originList);
    if (rel !== undefined) {
      lit.setLiteralValue(rel);
      rewrittenUrls++;
    }
  }
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    const rel = toRelative(lit.getLiteralValue(), originList);
    if (rel !== undefined) {
      lit.replaceWithText(`'${rel.replace(/'/g, "\\'")}'`);
      rewrittenUrls++;
    }
  }
  const foreign = sf
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .map((l) => l.getLiteralValue())
    .filter((v) => /^https?:\/\//.test(v));
  for (const v of new Set(foreign))
    warnings.push(`Absolute URL kept (origin not in env baseUrl/aliases): ${v}`);

  // 3. wrap top-level test(...) calls in test.describe(name, { tag }, ...)
  const tags = ctx.tags?.length ? ctx.tags : DEFAULT_TAGS;
  let wrapped = false;
  const alreadyDescribed = sf.getStatements().some((s) => /^\s*test\.describe\(/.test(s.getText()));
  if (!alreadyDescribed) {
    const testStatements = sf.getStatements().filter((s) => {
      if (s.getKind() !== SyntaxKind.ExpressionStatement) return false;
      const expr = s.asKindOrThrow(SyntaxKind.ExpressionStatement).getExpression();
      if (expr.getKind() !== SyntaxKind.CallExpression) return false;
      const callee = expr.asKindOrThrow(SyntaxKind.CallExpression).getExpression().getText();
      return callee === 'test' || /^test\.(only|skip|fixme|slow)$/.test(callee);
    });
    if (testStatements.length) {
      const bodies = testStatements.map((s) => s.getText());
      const index = testStatements[0]!.getChildIndex();
      for (const s of testStatements) s.remove();
      const tagList = tags.map((t) => `'${t}'`).join(', ');
      sf.insertStatements(
        index,
        `test.describe(${JSON.stringify(ctx.meta.name)}, { tag: [${tagList}] }, () => {\n${bodies.map((b) => indent(b, 2)).join('\n\n')}\n});`,
      );
      wrapped = true;
    } else {
      warnings.push('No top-level test(...) call found to wrap in test.describe.');
    }
  }

  // 4. fragile-locator markers (line based, after the AST pass)
  let fragileLocators = 0;
  const lines = sf.getFullText().split('\n');
  const annotated: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prev = annotated[annotated.length - 1] ?? '';
    if (FRAGILE_LOCATOR_RE.test(line) && !prev.includes('sdods:fragile')) {
      const ws = /^\s*/.exec(line)?.[0] ?? '';
      annotated.push(
        `${ws}// sdods:fragile — prefer getByRole/getByLabel/getByTestId; see docs/guides/self-healing-locators`,
      );
      fragileLocators++;
    }
    annotated.push(line);
  }

  const code = `${formatRecordingHeader(ctx.meta)}\n${annotated.join('\n').replace(/^\n+/, '')}`;
  return {
    code: code.endsWith('\n') ? code : code + '\n',
    warnings,
    fragileLocators,
    rewrittenUrls,
    wrapped,
  };
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}
