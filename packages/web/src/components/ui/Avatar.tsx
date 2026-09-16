import { cn } from '../../lib/utils';

const TONES = [
  'bg-brand-600',
  'bg-teal-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-emerald-600',
];

/** "Ada Lovelace" → "AL", "ada.lovelace" → "AL", "admin" → "AD". */
export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

/** Stable per name, so a person keeps one colour across reloads. */
function tone(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

export function Avatar({
  name,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  /** What the colour is keyed on; defaults to the name. Pass the username so a rename keeps it. */
  seed?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' && 'h-6 w-6 text-[10px]',
        size === 'md' && 'h-8 w-8 text-xs',
        size === 'lg' && 'h-14 w-14 text-lg',
        tone(seed ?? name),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
