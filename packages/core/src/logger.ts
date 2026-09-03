import pc from 'picocolors';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'step' | 'debug';
const ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  step: 4,
  debug: 5,
};

let globalLevel: LogLevel = (process.env.AUTOMAX_LOG_LEVEL as LogLevel) || 'info';
let jsonMode = process.env.AUTOMAX_LOG_JSON === '1';
const SECRET_KEY = /(password|secret|token|apikey|api_key|authorization|cookie)/i;

export function setLogLevel(level: LogLevel) {
  globalLevel = level;
}
export function setLogJson(enabled: boolean) {
  jsonMode = enabled;
}
export function getLogLevel(): LogLevel {
  return globalLevel;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SECRET_KEY.test(k) && typeof v === 'string' && v.length > 0 ? '***' : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export class Logger {
  constructor(private readonly context: string) {}

  child(sub: string): Logger {
    return new Logger(`${this.context}:${sub}`);
  }

  private emit(level: LogLevel, message: string, data?: unknown) {
    if (ORDER[level] > ORDER[globalLevel]) return;
    const safe = data === undefined ? undefined : redact(data);
    if (jsonMode) {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        level,
        ctx: this.context,
        msg: message,
        data: safe,
      });
      (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
      return;
    }
    const color =
      level === 'error'
        ? pc.red
        : level === 'warn'
          ? pc.yellow
          : level === 'debug'
            ? pc.gray
            : level === 'step'
              ? pc.cyan
              : pc.green;
    const tag = color(`[${level.toUpperCase()}]`);
    const prefix = `${pc.dim(ts())} ${tag} ${pc.magenta(`[${this.context}]`)}`;
    const body = level === 'step' ? `▶ ${message}` : message;
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${prefix} ${body}\n`);
    if (safe !== undefined)
      stream.write(pc.dim(`  └─ ${typeof safe === 'string' ? safe : JSON.stringify(safe)}\n`));
  }

  error(message: string, data?: unknown) {
    this.emit('error', message, data);
  }
  warn(message: string, data?: unknown) {
    this.emit('warn', message, data);
  }
  info(message: string, data?: unknown) {
    this.emit('info', message, data);
  }
  step(message: string, data?: unknown) {
    this.emit('step', message, data);
  }
  debug(message: string, data?: unknown) {
    this.emit('debug', message, data);
  }
  separator(title?: string) {
    if (ORDER.info > ORDER[globalLevel] || jsonMode) return;
    const line = '─'.repeat(60);
    process.stdout.write(pc.dim(title ? `${line} ${title} ${line}\n` : `${line}${line}\n`));
  }
}

export const rootLogger = new Logger('automax');
