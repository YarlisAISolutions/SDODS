/** Structured errors: every CLI/MCP/server surface renders `{ code, message, hint, docsUrl }`. */
export type SdodsErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_SECRET_LITERAL'
  | 'CONFIG_UNRESOLVED_VAR'
  | 'PROJECT_NOT_FOUND'
  | 'ENV_NOT_FOUND'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_ROW_NOT_FOUND'
  | 'USER_POOL_EXHAUSTED'
  | 'USER_POOL_TOO_SMALL'
  | 'HEAL_FAILED'
  | 'LINT_FAILED'
  | 'RUN_FAILED'
  | 'GATE_FAILED'
  | 'HAR_MISS'
  | 'DB_REQUIRED'
  | 'MAIL_REQUIRED'
  | 'MAIL_NOT_RECEIVED'
  | 'AUTH_FAILED'
  | 'NOT_SUPPORTED'
  | 'INTERNAL';

export const DOCS_BASE_URL = 'https://docs.sdods.com';

export interface SdodsErrorOptions {
  hint?: string;
  docsPath?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  exitCode?: number;
}

export class SdodsError extends Error {
  readonly code: SdodsErrorCode;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly details?: Record<string, unknown>;
  readonly exitCode: number;

  constructor(code: SdodsErrorCode, message: string, opts: SdodsErrorOptions = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'SdodsError';
    this.code = code;
    this.hint = opts.hint;
    this.docsUrl = opts.docsPath ? `${DOCS_BASE_URL}${opts.docsPath}` : undefined;
    this.details = opts.details;
    this.exitCode =
      opts.exitCode ?? (code.startsWith('CONFIG') || code.endsWith('NOT_FOUND') ? 2 : 1);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint,
      docsUrl: this.docsUrl,
      details: this.details,
    };
  }
}

export class SdodsConfigError extends SdodsError {
  constructor(message: string, opts: SdodsErrorOptions & { code?: SdodsErrorCode } = {}) {
    super(opts.code ?? 'CONFIG_INVALID', message, {
      docsPath: '/docs/guides/configuration',
      ...opts,
    });
    this.name = 'SdodsConfigError';
  }
}

export function isSdodsError(e: unknown): e is SdodsError {
  return (
    e instanceof SdodsError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'SdodsError')
  );
}

export function errorToJson(e: unknown): {
  code: string;
  message: string;
  hint?: string;
  docsUrl?: string;
} {
  if (isSdodsError(e)) return e.toJSON();
  if (e instanceof Error) return { code: 'INTERNAL', message: e.message };
  return { code: 'INTERNAL', message: String(e) };
}
