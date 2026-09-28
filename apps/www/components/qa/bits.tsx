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

/**
 * Says what the archive is, wherever it is shown.
 *
 * The threads were written by the SDODS team to document real problems and their fixes, and the
 * people in them are illustrative. Presented as a live community -- with reputation, join dates,
 * votes and view counts -- they read as social proof that does not exist, so none of those are
 * shown, and this says so plainly.
 */
export function ExampleNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p
      className={`rounded-lg border border-[var(--line)] bg-[var(--brand)]/5 text-sm ${
        compact ? 'px-3 py-2' : 'p-4'
      }`}
    >
      <span className="font-semibold">Example threads.</span> These questions and answers were
      written by the SDODS team to document real problems and how to fix them. The people named are
      illustrative, not real users. Questions asked on this site are marked <em>new</em>.
    </p>
  );
}

/** Name and badge -- the byline under an example post. No reputation and no date: see ExampleNotice. */
export function Byline({ handle, action = 'asked' }: { handle: string; action?: string }) {
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
            SDODS team
          </span>
        )}
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
  return p.role === 'maintainer' ? 'SDODS team (illustrative)' : 'Illustrative user';
}
