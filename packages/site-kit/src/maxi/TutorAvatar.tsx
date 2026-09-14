/**
 * Maxi, the SDODS tutor: the avatar that narrates the docs and answers in the chat.
 *
 * Drawn from the same palette as the docs illustrations, so it reads as part of the book on the docs
 * site and as the same character on sdods.com.
 */

/** The docs illustration palette (apps/docs/components/art/kit.tsx), the colours Maxi uses. */
const C = {
  ink: '#1f2937',
  line: '#cbd5e1',
  indigo: '#6366f1',
  indigoDeep: '#4338ca',
  teal: '#2dd4bf',
  amber: '#f59e0b',
  coral: '#fb7185',
  green: '#22c55e',
  paper: '#ffffff',
  slate: '#94a3b8',
} as const;

export type TutorMood = 'idle' | 'talking' | 'thinking' | 'happy' | 'concerned';

const EYES: Record<TutorMood, { left: string; right: string; mouth: string }> = {
  idle: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 51q6 4 12 0' },
  talking: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 49q6 7 12 0' },
  thinking: { left: 'M26 41h7', right: 'M43 38h7', mouth: 'M33 52q5 -3 10 0' },
  happy: { left: 'M26 42q3.5 -6 7 0', right: 'M43 42q3.5 -6 7 0', mouth: 'M31 48q7 9 14 0z' },
  concerned: { left: 'M26 38l7 3', right: 'M43 41l7 -3', mouth: 'M33 53q5 -5 10 0' },
};

/** A 76 × 96 tutor. Antenna colour carries the mood so it reads at a glance. */
export function TutorAvatar({
  mood = 'idle',
  size = 76,
  decorative = false,
  name = 'Maxi the tutor',
}: {
  mood?: TutorMood;
  size?: number;
  /** Set when the name and the line are already beside the drawing, so it adds nothing to read. */
  decorative?: boolean;
  /** Accessible name when the drawing is not decorative. */
  name?: string;
}) {
  const face = EYES[mood];
  const antenna = mood === 'concerned' ? C.coral : mood === 'happy' ? C.green : C.amber;
  return (
    <svg
      viewBox="0 0 76 96"
      width={size}
      height={(size * 96) / 76}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${name}, looking ${mood}`}
      className="sk-avatar"
    >
      <ellipse cx="38" cy="92" rx="22" ry="4" fill={C.line} opacity="0.5" />
      <rect x="24" y="8" width="3.5" height="12" rx="1.75" fill={C.slate} />
      <circle cx="25.7" cy="7" r="4.5" fill={antenna} />
      <rect x="6" y="20" width="64" height="46" rx="16" fill={C.indigo} />
      <rect x="14" y="29" width="48" height="28" rx="11" fill={C.paper} />
      <g stroke={C.ink} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d={face.left} />
        <path d={face.right} />
      </g>
      {mood === 'happy' ? (
        <path d={face.mouth} fill={C.ink} />
      ) : (
        <path d={face.mouth} stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      )}
      <rect x="0" y="34" width="8" height="22" rx="4" fill={C.indigoDeep} />
      <rect x="68" y="34" width="8" height="22" rx="4" fill={C.indigoDeep} />
      <rect x="18" y="66" width="40" height="20" rx="8" fill={C.indigoDeep} />
      <rect x="27" y="72" width="22" height="8" rx="4" fill={C.teal} />
    </svg>
  );
}
