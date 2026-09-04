import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import AjvModule, { type ErrorObject } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { ZodType } from 'zod';
import type { ResolvedConfig } from '../config/resolve.js';
import { SdodsError } from '../errors.js';

// ajv and ajv-formats are CJS with `exports.default`; normalise for NodeNext ESM interop.
const AjvCtor = ((AjvModule as any).default ?? AjvModule) as new (
  opts: Record<string, unknown>,
) => any;
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (ajv: any) => void;
const ajv = new AjvCtor({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateJsonSchema(value: unknown, schema: object): ValidationResult {
  const validate = ajv.compile(schema);
  const ok = validate(value);
  return { ok: Boolean(ok), errors: (validate.errors ?? []).map(formatAjvError) };
}

function formatAjvError(e: ErrorObject): string {
  return `${e.instancePath || '<root>'} ${e.message ?? ''}${e.params ? ' ' + JSON.stringify(e.params) : ''}`.trim();
}

/** Load a JSON schema file relative to the project root (or `schemas/`). */
export function loadJsonSchema(config: ResolvedConfig, file: string): object {
  const candidates = [
    file,
    join('schemas', file),
    join('schemas', `${file}.schema.json`),
    join('schemas', `${file}.json`),
  ].map((f) => (isAbsolute(f) ? f : resolvePath(config.project.root, f)));
  const found = candidates.find((f) => existsSync(f));
  if (!found) {
    throw new SdodsError(
      'DATASET_NOT_FOUND',
      `JSON schema "${file}" not found. Tried: ${candidates.join(', ')}`,
      {
        hint: 'Put schemas under projects/<slug>/schemas/ and reference them by name.',
      },
    );
  }
  return JSON.parse(readFileSync(found, 'utf8')) as object;
}

export function validateZod(value: unknown, schema: ZodType): ValidationResult {
  const r = schema.safeParse(value);
  return {
    ok: r.success,
    errors: r.success
      ? []
      : r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
  };
}

/** Load a zod schema exported from `projects/<slug>/schemas/<name>.ts` (default export or named). */
export async function loadZodSchema(config: ResolvedConfig, spec: string): Promise<ZodType> {
  const [fileName, exportName] = spec.split('#');
  const candidates = [fileName!, join('schemas', fileName!), join('schemas', `${fileName}.ts`)].map(
    (f) => (isAbsolute(f) ? f : resolvePath(config.project.root, f)),
  );
  const found = candidates.find((f) => existsSync(f));
  if (!found)
    throw new SdodsError(
      'DATASET_NOT_FOUND',
      `Zod schema module "${spec}" not found under ${config.project.root}/schemas.`,
    );
  const mod = (await import(pathToFileURL(found).href)) as Record<string, unknown>;
  const schema = (exportName ? mod[exportName] : (mod.default ?? mod.schema)) as
    ZodType | undefined;
  if (!schema || typeof (schema as any).safeParse !== 'function') {
    throw new SdodsError(
      'CONFIG_INVALID',
      `Module ${found} does not export a zod schema${exportName ? ` named "${exportName}"` : ' as default'}.`,
    );
  }
  return schema;
}

interface OpenApiDoc {
  paths?: Record<
    string,
    Record<
      string,
      { responses?: Record<string, { content?: Record<string, { schema?: object }> }> }
    >
  >;
  components?: { schemas?: Record<string, object> };
}

const openApiCache = new Map<string, Promise<OpenApiDoc>>();

export async function loadOpenApi(config: ResolvedConfig, specPath?: string): Promise<OpenApiDoc> {
  const spec = specPath ?? config.env.api.openapi;
  if (!spec) {
    throw new SdodsError(
      'CONFIG_INVALID',
      'No OpenAPI spec configured. Set env.api.openapi (path or URL) in envs/<env>.yaml.',
    );
  }
  const key = `${config.project.root}|${spec}`;
  if (!openApiCache.has(key)) {
    openApiCache.set(
      key,
      (async () => {
        const { dereference } = await import('@scalar/openapi-parser');
        let source: string | object;
        if (/^https?:\/\//.test(spec)) {
          const res = await fetch(spec);
          if (!res.ok) throw new Error(`Cannot fetch OpenAPI spec ${spec}: ${res.status}`);
          source = await res.text();
        } else {
          const file = isAbsolute(spec) ? spec : resolvePath(config.project.root, spec);
          source = readFileSync(file, 'utf8');
        }
        const result = await dereference(source as any);
        if (!result.schema)
          throw new Error(
            `Cannot parse OpenAPI spec ${spec}: ${JSON.stringify(result.errors ?? [])}`,
          );
        return result.schema as OpenApiDoc;
      })(),
    );
  }
  return openApiCache.get(key)!;
}

/** Find the response schema for method + path (+ status) in a dereferenced OpenAPI document. */
export function openApiResponseSchema(
  doc: OpenApiDoc,
  method: string,
  path: string,
  status = 200,
): object | undefined {
  const paths = doc.paths ?? {};
  const key = Object.keys(paths).find((p) => p === path || templateMatches(p, path));
  if (!key) return undefined;
  const op = paths[key]?.[method.toLowerCase()];
  const resp = op?.responses?.[String(status)] ?? op?.responses?.default;
  const content = resp?.content ?? {};
  const media = content['application/json'] ?? Object.values(content)[0];
  return media?.schema;
}

export function openApiComponentSchema(doc: OpenApiDoc, name: string): object | undefined {
  return doc.components?.schemas?.[name];
}

function templateMatches(template: string, actual: string): boolean {
  const re = new RegExp(
    '^' + template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '[^/]+') + '$',
  );
  return re.test(actual);
}

export async function validateAgainstOpenApi(
  config: ResolvedConfig,
  method: string,
  path: string,
  status: number,
  body: unknown,
): Promise<ValidationResult> {
  const doc = await loadOpenApi(config);
  const schema = openApiResponseSchema(doc, method, path, status);
  if (!schema)
    return {
      ok: false,
      errors: [
        `No response schema in the OpenAPI spec for ${method.toUpperCase()} ${path} (${status}).`,
      ],
    };
  return validateJsonSchema(body, schema);
}
