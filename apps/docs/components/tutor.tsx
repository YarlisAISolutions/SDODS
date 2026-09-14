/**
 * Maxi, the tutor.
 *
 * Maxi narrates the runnable scenarios in the getting-started pages and the checkpoints on the
 * roadmap. The avatar is drawn from the same palette as the page illustrations so both read as
 * part of the book rather than widgets dropped into it, and Maxi only ever says something the
 * page actually shows. The drawing lives in @sdods/site-kit so the chat on both sites shares it.
 */
import { TutorAvatar, type TutorMood } from '@sdods/site-kit';

export { TutorAvatar, type TutorMood };

/** The tutor strip: avatar on the left, one sentence in a speech bubble beside it. */
export function TutorBar({
  mood,
  text,
  className = 'border-t border-fd-border bg-fd-muted/40 px-4 py-3',
}: {
  mood: TutorMood;
  text: string;
  /** The framing around the bubble; the roadmap wants a free-standing card, not a bottom strip. */
  className?: string;
}) {
  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <TutorAvatar mood={mood} size={56} decorative />
      <div className="relative flex-1 rounded-xl rounded-bl-none border border-fd-border bg-fd-card px-4 py-3 text-sm leading-relaxed">
        <span className="mb-0.5 block text-xs font-semibold tracking-wide text-fd-muted-foreground uppercase">
          Maxi
        </span>
        {text}
      </div>
    </div>
  );
}
