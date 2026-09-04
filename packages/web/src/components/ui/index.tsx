import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils';

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        variant === 'default' && 'border-line bg-[var(--panel)] hover:bg-[var(--panel-2)]',
        variant === 'primary' && 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700',
        variant === 'danger' && 'border-red-600 bg-red-600 text-white hover:bg-red-700',
        variant === 'ghost' && 'border-transparent hover:bg-[var(--panel-2)]',
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('panel p-4', className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
  className?: string;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
    green: 'bg-green-500/15 text-green-700 dark:text-green-300',
    red: 'bg-red-500/15 text-red-700 dark:text-red-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    blue: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    purple: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  };
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'passed'
      ? 'green'
      : status === 'failed' || status === 'error' || status === 'timedOut'
        ? 'red'
        : status === 'running' || status === 'queued'
          ? 'blue'
          : status === 'flaky'
            ? 'amber'
            : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return <Badge>no access</Badge>;
  const tone =
    role === 'admin' || role === 'owner' ? 'purple' : role === 'editor' ? 'blue' : 'neutral';
  return <Badge tone={tone}>{role}</Badge>;
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const tone =
    tag === '@ui' || tag === '@api' || tag === '@hybrid'
      ? 'blue'
      : /^@(smoke|regression|sanity)$/.test(tag)
        ? 'purple'
        : tag.startsWith('@jira:') || tag.startsWith('@github:')
          ? 'amber'
          : 'neutral';
  return (
    <Badge tone={tone} className="mono gap-1">
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`remove ${tag}`}
          className="opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </Badge>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-line bg-[var(--panel)] px-2.5 py-1.5 text-sm',
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'mono w-full rounded-md border border-line bg-[var(--panel)] px-2.5 py-1.5',
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-md border border-line bg-[var(--panel)] px-2 py-1.5 text-sm',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium muted">{label}</span>
      {children}
      {hint && <span className="block text-[11px] muted">{hint}</span>}
      {error && <span className="block text-[11px] text-red-500">{error}</span>}
    </label>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {hint && <div className="text-xs muted">{hint}</div>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm muted" role="status">
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error as { message?: string; hint?: string; code?: string };
  return (
    <div className="panel border-red-500/50 p-3 text-sm">
      <div className="font-medium text-red-600">
        {e?.code ?? 'Error'}: {e?.message ?? String(error)}
      </div>
      {e?.hint && <div className="muted mt-1 text-xs">{e.hint}</div>}
      {retry && (
        <Button size="sm" className="mt-2" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <div className="muted text-xs">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-[var(--panel-2)] px-1 text-[10px] mono">
      {children}
    </kbd>
  );
}

export function TotalsBar({
  totals,
}: {
  totals?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky?: number;
  } | null;
}) {
  if (!totals || !totals.total) return <span className="muted text-xs">—</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 ? (
      <div
        className={cn('h-2', cls)}
        style={{ width: `${(n / totals.total) * 100}%` }}
        title={`${label}: ${n}`}
      />
    ) : null;
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-28 overflow-hidden rounded bg-slate-500/20">
        {seg(totals.passed, 'bg-green-500', 'passed')}
        {seg(totals.failed, 'bg-red-500', 'failed')}
        {seg(totals.skipped, 'bg-amber-400', 'skipped')}
      </div>
      <span className="text-xs">
        <span className="status-passed">{totals.passed}</span> /{' '}
        <span className="status-failed">{totals.failed}</span> /{' '}
        <span className="status-skipped">{totals.skipped}</span>
        {totals.flaky ? <span className="status-flaky"> ·{totals.flaky} flaky</span> : null}
      </span>
    </div>
  );
}
