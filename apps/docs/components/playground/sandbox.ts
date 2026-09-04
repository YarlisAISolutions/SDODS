/**
 * The API side of the playground.
 *
 * Requests go to the same public sandbox `projects/demo-shop/envs/staging.yaml` points at, so what
 * the reader sees here is the exchange the CLI would attach to the scenario. When the network is
 * unavailable — an offline reader, a corporate proxy, a blocked origin — the same request is
 * answered from a recorded response and labelled `replayed`, which is exactly what
 * `sdods run --har-replay` does in CI.
 */

export const API_BASE = 'https://jsonplaceholder.typicode.com';
export const UI_BASE = 'https://www.saucedemo.com';

export type NetworkMode = 'live' | 'replay';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Exchange {
  method: HttpMethod;
  url: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  body: unknown;
  timeMs: number;
  source: NetworkMode;
  note?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'max-age=43200',
};

function post(id: number) {
  return {
    userId: Math.ceil(id / 10),
    id,
    title:
      id === 1
        ? 'sunt aut facere repellat provident occaecati excepturi optio reprehenderit'
        : `recorded post ${id}`,
    body: id === 1 ? 'quia et suscipit\nsuscipit recusandae consequuntur' : 'recorded body',
  };
}

/** The bodies used when the sandbox cannot be reached. Shapes match the live service. */
function recorded(
  method: HttpMethod,
  path: string,
  body?: unknown,
): { status: number; body: unknown } {
  const [pathname, query] = path.split('?');
  const userId = new URLSearchParams(query ?? '').get('userId');

  if (method === 'GET' && pathname === '/posts') {
    const all = Array.from({ length: 100 }, (_, i) => post(i + 1));
    return { status: 200, body: userId ? all.filter((p) => p.userId === Number(userId)) : all };
  }
  if (method === 'GET' && /^\/posts\/\d+$/.test(pathname ?? '')) {
    const id = Number(pathname!.split('/')[2]);
    return id > 100 ? { status: 404, body: {} } : { status: 200, body: post(id) };
  }
  if (method === 'GET' && /^\/posts\/\d+\/comments$/.test(pathname ?? '')) {
    const postId = Number(pathname!.split('/')[2]);
    return {
      status: 200,
      body: Array.from({ length: 5 }, (_, i) => ({
        postId,
        id: (postId - 1) * 5 + i + 1,
        name: `recorded comment ${i + 1}`,
        email: `reader${i + 1}@example.com`,
        body: 'recorded comment body',
      })),
    };
  }
  if (method === 'GET' && /^\/users\/\d+$/.test(pathname ?? '')) {
    const id = Number(pathname!.split('/')[2]);
    return {
      status: 200,
      body: { id, name: 'Leanne Graham', username: 'Bret', email: 'Sincere@april.biz' },
    };
  }
  if (method === 'POST' && pathname === '/posts') {
    return { status: 201, body: { ...(body as Record<string, unknown>), id: 101 } };
  }
  if (method === 'PUT' || method === 'PATCH') {
    const id = Number((pathname ?? '').split('/')[2] ?? 1);
    return { status: 200, body: { ...post(id), ...(body as Record<string, unknown>) } };
  }
  if (method === 'DELETE') return { status: 200, body: {} };
  return { status: 404, body: {} };
}

const TIMEOUT_MS = 8000;

/**
 * Sends one request and returns the exchange the report shows. Never throws for an HTTP status:
 * a 404 is a result the scenario is allowed to assert on, only a transport failure falls back
 * to the recording.
 */
export async function sendRequest(options: {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  mode: NetworkMode;
  signal?: AbortSignal;
}): Promise<Exchange> {
  const { method, path, headers, body, mode, signal } = options;
  const url = `${API_BASE}${path}`;
  const started = performance.now();

  const replay = (note?: string): Exchange => {
    const rec = recorded(method, path, body);
    return {
      method,
      url,
      path,
      requestHeaders: headers,
      requestBody: body,
      status: rec.status,
      statusText: rec.status === 201 ? 'Created' : rec.status === 404 ? 'Not Found' : 'OK',
      responseHeaders: JSON_HEADERS,
      body: rec.body,
      timeMs: Math.round(performance.now() - started),
      source: 'replay',
      note,
    };
  };

  if (mode === 'replay') return replay();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop);

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { ...headers, 'content-type': 'application/json' } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const timeMs = Math.round(performance.now() - started);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    let parsed: unknown = text;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      /* a non-JSON body is shown verbatim, the way the report shows it */
    }
    return {
      method,
      url,
      path,
      requestHeaders: headers,
      requestBody: body,
      status: response.status,
      statusText: response.statusText,
      responseHeaders,
      body: parsed,
      timeMs,
      source: 'live',
    };
  } catch {
    return replay('the sandbox could not be reached, so a recorded response answered this step');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** `$.length`, `id`, `[0].id`, `data.items[2].name` — the paths the API step library accepts. */
export function jsonPath(value: unknown, path: string): unknown {
  const normalised = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
  const parts = normalised.split('.').filter((p) => p !== '');
  let cursor: unknown = value;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (part === 'length') {
      if (Array.isArray(cursor) || typeof cursor === 'string') {
        cursor = cursor.length;
        continue;
      }
      return undefined;
    }
    if (Array.isArray(cursor)) {
      cursor = cursor[Number(part)];
      continue;
    }
    if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cursor;
}

export interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  minLength?: number;
  minimum?: number;
}

/** The `post` schema shipped in `projects/demo-shop/schemas/post.schema.json`. */
export const SCHEMAS: Record<string, JsonSchema> = {
  post: {
    type: 'object',
    required: ['id', 'title', 'userId'],
    properties: {
      id: { type: 'integer', minimum: 1 },
      userId: { type: 'integer', minimum: 1 },
      title: { type: 'string', minLength: 1 },
      body: { type: 'string' },
    },
  },
};

/** A deliberately small validator: enough for the shipped schema, honest about the rest. */
export function validateSchema(value: unknown, schema: JsonSchema, at = '$'): string[] {
  const errors: string[] = [];
  const typeOf = (v: unknown) =>
    Array.isArray(v)
      ? 'array'
      : v === null
        ? 'null'
        : typeof v === 'number' && Number.isInteger(v)
          ? 'integer'
          : typeof v;

  if (schema.type) {
    const actual = typeOf(value);
    const ok =
      schema.type === 'number'
        ? actual === 'integer' || actual === 'number'
        : actual === schema.type;
    if (!ok) return [`${at} should be ${schema.type} but was ${actual}`];
  }
  if (schema.type === 'object' && value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${at}.${key} is required and missing`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in record) errors.push(...validateSchema(record[key], sub, `${at}.${key}`));
    }
  }
  if (
    typeof value === 'string' &&
    schema.minLength !== undefined &&
    value.length < schema.minLength
  )
    errors.push(`${at} is shorter than ${schema.minLength}`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum)
    errors.push(`${at} is below the minimum ${schema.minimum}`);
  return errors;
}
