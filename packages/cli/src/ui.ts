import pc from 'picocolors';
import { errorToJson, isSdodsError } from '@sdods/core';

export interface OutputOptions {
  json?: boolean;
  quiet?: boolean;
}

export function out(text: string, opts: OutputOptions = {}) {
  if (opts.quiet) return;
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

export function json(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function table(rows: Array<Record<string, unknown>>, columns?: string[]) {
  if (rows.length === 0) return out(pc.dim('(none)'));
  const cols = columns ?? Object.keys(rows[0]!);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join('  ');
  out(pc.bold(line(cols)));
  out(pc.dim(line(widths.map((w) => '─'.repeat(w)))));
  for (const r of rows) out(line(cols.map((c) => String(r[c] ?? ''))));
}

export function ok(msg: string) {
  out(`${pc.green('✔')} ${msg}`);
}
export function warn(msg: string) {
  process.stderr.write(`${pc.yellow('⚠')} ${msg}\n`);
}
export function info(msg: string) {
  out(`${pc.cyan('ℹ')} ${msg}`);
}
export function heading(msg: string) {
  out(`\n${pc.bold(pc.underline(msg))}`);
}

/** Render an error and return the process exit code. */
export function renderError(e: unknown, asJson: boolean): number {
  const body = errorToJson(e);
  if (asJson) {
    process.stderr.write(JSON.stringify({ error: body }) + '\n');
  } else {
    process.stderr.write(`${pc.red('✖')} ${pc.bold(body.code)}: ${body.message}\n`);
    if (body.hint) process.stderr.write(`  ${pc.dim('hint:')} ${body.hint}\n`);
    if (body.docsUrl) process.stderr.write(`  ${pc.dim('docs:')} ${body.docsUrl}\n`);
    if (process.env.SDODS_DEBUG && e instanceof Error && e.stack)
      process.stderr.write(pc.dim(e.stack) + '\n');
  }
  if (isSdodsError(e)) return e.exitCode;
  return 1;
}

export function parseIntFlag(name: string) {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`--${name} expects a non-negative integer, got "${v}"`);
    return n;
  };
}

export function collect(value: string, previous: string[] = []): string[] {
  return previous.concat(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
