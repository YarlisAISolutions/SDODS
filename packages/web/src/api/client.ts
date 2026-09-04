export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public hint?: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const BASE = import.meta.env.VITE_API_BASE ?? '';

export async function api<T>(
  path: string,
  init: RequestInit & { json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  } else if (init.form) {
    body = init.form;
  }
  const method = (init.method ?? (body ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers.set('x-csrf-token', csrfToken);
  headers.set('accept', 'application/json');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    method,
    headers,
    body,
    credentials: 'include',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const err = parsed?.error ?? parsed ?? {};
    throw new ApiError(
      res.status,
      err.code ?? `HTTP_${res.status}`,
      err.message ?? res.statusText,
      err.hint,
      parsed,
    );
  }
  return parsed as T;
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
