import Link from 'next/link';
import { avatarHue, initials, person, type Person } from '@sdods/qa-archive';

/**
 * An avatar drawn from the handle: initials on a hue hashed from the same string. Deterministic, so
 * it never changes between builds, and no photograph — nothing here should imply a real face.
 */
export function Avatar({ handle, size = 28 }: { handle: string; size?: number }) {
  const p = person(handle);
  const hue = avatarHue(handle);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 62% 88%)`,
        color: `hsl(${hue} 55% 28%)`,
      }}
    >
      {initials(p?.display ?? handle)}
    </span>
  );
}

/** Name, badge and reputation — the byline under a post. */
export function Byline({
  handle,
  date,
  action = 'asked',
}: {
  handle: string;
  date: string;
  action?: string;
}) {
  const p = person(handle);
  return (
    <span className="muted inline-flex items-center gap-2 text-xs">
      <Avatar handle={handle} size={24} />
      <span>
        {action}{' '}
        <Link href={`/questions/users/${handle}/`} className="font-medium hover:underline">
          {p?.display ?? handle}
        </Link>
        {p?.role === 'maintainer' && (
          <span className="ml-1.5 rounded bg-[var(--brand)]/12 px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--brand)]">
            maintainer
          </span>
        )}
        {p && <span className="ml-1.5 tabular-nums">{p.rep.toLocaleString()}</span>}
        {' · '}
        <time dateTime={date}>{formatDate(date)}</time>
      </span>
    </span>
  );
}

export function TagChip({ name, active = false }: { name: string; active?: boolean }) {
  return (
    <Link
      href={`/questions/tags/${name}/`}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active
          ? 'bg-[var(--brand)] text-white'
          : 'bg-[var(--brand)]/10 text-[var(--brand)] hover:bg-[var(--brand)]/20'
      }`}
    >
      {name}
    </Link>
  );
}

/** A small count with its label, as on a question's left rail. */
export function Stat({ n, label, strong = false }: { n: number; label: string; strong?: boolean }) {
  return (
    <span className="flex min-w-[3.25rem] flex-col items-center">
      <span className={`tabular-nums ${strong ? 'font-semibold text-emerald-600' : ''}`}>
        {n.toLocaleString()}
      </span>
      <span className="muted text-[0.7rem]">{label}</span>
    </span>
  );
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function personLabel(p: Person): string {
  return p.role === 'maintainer' ? 'Maintainer' : p.role === 'regular' ? 'Regular' : 'Member';
}
