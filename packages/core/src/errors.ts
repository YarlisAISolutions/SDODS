/** Structured errors: every CLI/MCP/server surface renders `{ code, message, hint, docsUrl }`. */
export type AutomaxErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_SECRET_LITERAL'
  | 'CONFIG_UNRESOLVED_VAR'
  | 'PROJECT_NOT_FOUND'
  | 'ENV_NOT_FOUND'
  | 'DATASET_NOT_FOUND'
  | 'DATASET_ROW_NOT_FOUND'
  | 'USER_POOL_EXHAUSTED'
  | 'HEAL_FAILED'
  | 'LINT_FAILED'
  | 'RUN_FAILED'
  | 'HAR_MISS'
  | 'DB_REQUIRED'
  | 'AUTH_FAILED'
  | 'NOT_SUPPORTED'
  | 'INTERNAL';

export const DOCS_BASE_URL = 'https://yarlagadda.github.io/AutoMax';

export interface AutomaxErrorOptions {
  hint?: string;
  docsPath?: string;
  cause?: unknown;
  details?: Record<string, unknown>;
  exitCode?: number;
}

export class AutomaxError extends Error {
  readonly code: AutomaxErrorCode;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly details?: Record<string, unknown>;
  readonly exitCode: number;

  constructor(code: AutomaxErrorCode, message: string, opts: AutomaxErrorOptions = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AutomaxError';
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

export class AutomaxConfigError extends AutomaxError {
  constructor(message: string, opts: AutomaxErrorOptions & { code?: AutomaxErrorCode } = {}) {
    super(opts.code ?? 'CONFIG_INVALID', message, {
      docsPath: '/docs/guides/configuration',
      ...opts,
    });
    this.name = 'AutomaxConfigError';
  }
}

export function isAutomaxError(e: unknown): e is AutomaxError {
  return (
    e instanceof AutomaxError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'AutomaxError')
  );
}

export function errorToJson(e: unknown): {
  code: string;
  message: string;
  hint?: string;
  docsUrl?: string;
} {
  if (isAutomaxError(e)) return e.toJSON();
  if (e instanceof Error) return { code: 'INTERNAL', message: e.message };
  return { code: 'INTERNAL', message: String(e) };
}
