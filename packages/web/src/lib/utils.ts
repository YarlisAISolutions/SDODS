export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function fmtDuration(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const unit =
    abs < 60_000
      ? [Math.round(abs / 1000), 's']
      : abs < 3_600_000
        ? [Math.round(abs / 60_000), 'm']
        : abs < 86_400_000
          ? [Math.round(abs / 3_600_000), 'h']
          : [Math.round(abs / 86_400_000), 'd'];
  return diff >= 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}

export function pct(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function passRate(t?: { total: number; passed: number } | null): number {
  if (!t || !t.total) return 0;
  return t.passed / t.total;
}

export function shortSha(sha?: string): string {
  return sha ? sha.slice(0, 7) : '';
}

export function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

export function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = safeLocalStorage()?.getItem(`sdods:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref<T>(key: string, value: T) {
  try {
    safeLocalStorage()?.setItem(`sdods:${key}`, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Minimal unified-diff line classifier for rendering. */
export function classifyDiffLine(line: string): 'add' | 'del' | 'hunk' | 'meta' | 'ctx' {
  if (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ')
  )
    return 'meta';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}

export function toCurl(req: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}): string {
  const parts = [`curl -X ${req.method} '${req.url}'`];
  for (const [k, v] of Object.entries(req.headers ?? {})) parts.push(`-H '${k}: ${v}'`);
  if (req.body !== undefined && req.body !== null)
    parts.push(`--data '${typeof req.body === 'string' ? req.body : JSON.stringify(req.body)}'`);
  return parts.join(' \\\n  ');
}

/**
 * sdods.com's install page, opened on the tab for this machine's OS. The page detects the OS
 * itself too; passing it keeps the link right when it is copied to someone else.
 */
export function cliInstallUrl(ua: string = navigator.userAgent || ''): string {
  const os = /Windows/i.test(ua) ? 'windows' : /Mac OS X|Macintosh/i.test(ua) ? 'macos' : 'linux';
  return `https://sdods.com/install/?os=${os}`;
}
