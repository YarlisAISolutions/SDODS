/**
 * Maxi, the tutor who sits under every playground.
 *
 * The avatar is drawn from the same palette as the page illustrations so the playground looks
 * like part of the book rather than a widget dropped into it. Maxi only ever says something the
 * run actually shows — the line changes with the step that just ran and its outcome.
 */
import { C } from '../art/kit';

export type TutorMood = 'idle' | 'talking' | 'thinking' | 'happy' | 'concerned';

const EYES: Record<TutorMood, { left: string; right: string; mouth: string }> = {
  idle: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 51q6 4 12 0' },
  talking: { left: 'M26 40h7', right: 'M43 40h7', mouth: 'M32 49q6 7 12 0' },
  thinking: { left: 'M26 41h7', right: 'M43 38h7', mouth: 'M33 52q5 -3 10 0' },
  happy: { left: 'M26 42q3.5 -6 7 0', right: 'M43 42q3.5 -6 7 0', mouth: 'M31 48q7 9 14 0z' },
  concerned: { left: 'M26 38l7 3', right: 'M43 41l7 -3', mouth: 'M33 53q5 -5 10 0' },
};

/** A 76 × 96 tutor. Antenna colour carries the mood so it reads at a glance. */
export function TutorAvatar({ mood = 'idle', size = 76 }: { mood?: TutorMood; size?: number }) {
  const face = EYES[mood];
  const antenna = mood === 'concerned' ? C.coral : mood === 'happy' ? C.green : C.amber;
  return (
    <svg
      viewBox="0 0 76 96"
      width={size}
      height={(size * 96) / 76}
      role="img"
      aria-label={`Maxi the tutor, looking ${mood}`}
      className="shrink-0"
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

/** The tutor strip: avatar on the left, one sentence in a speech bubble beside it. */
export function TutorBar({ mood, text }: { mood: TutorMood; text: string }) {
  return (
    <div className="flex items-end gap-3 border-t border-fd-border bg-fd-muted/40 px-4 py-3">
      <TutorAvatar mood={mood} size={56} />
      <div className="relative flex-1 rounded-xl rounded-bl-none border border-fd-border bg-fd-card px-4 py-3 text-sm leading-relaxed">
        <span className="mb-0.5 block text-xs font-semibold tracking-wide text-fd-muted-foreground uppercase">
          Maxi
        </span>
        {text}
      </div>
    </div>
  );
}
