/**
 * Every checkpoint as ordinary prose.
 *
 * The road is the illustration; this is the content. It is always in the page, so the roadmap
 * survives having no JavaScript, being printed, and being read by anything that does not run
 * a browser.
 */
import { CHECKPOINTS, isChapter, type Checkpoint } from '@sdods/roadmap';
import { whenOf } from './checkpoint-card';

const GROUPS: Array<{ title: string; blurb: string; of: (c: Checkpoint) => boolean }> = [
  {
    title: 'The road behind',
    blurb:
      'Five chapters, already delivered. They carry no dates: they were built before the first release, in a repository whose history begins on 3 September 2026, so a month against each one would be a number nobody could check.',
    of: (c) => c.kind === 'chapter',
  },
  {
    title: 'The next twelve months',
    blurb: 'Close enough to promise, and ordered by what the one before it makes possible.',
    of: (c) => c.kind === 'month',
  },
  {
    title: 'The horizon',
    blurb: 'Direction rather than dated commitment. Feature requests move these.',
    of: (c) => c.kind === 'year',
  },
];

export function RoadmapChecklist() {
  return (
    <div className="not-prose my-6 space-y-8">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="text-lg font-semibold">{group.title}</h3>
          <p className="mt-1 text-sm text-fd-muted-foreground">{group.blurb}</p>
          <ol className="mt-4 space-y-4">
            {CHECKPOINTS.filter(group.of).map((checkpoint) => (
              <li
                key={checkpoint.id}
                id={checkpoint.id}
                className="rounded-lg border border-fd-border p-4"
              >
                <p className="text-xs text-fd-muted-foreground">{whenOf(checkpoint)}</p>
                <h4 className="mt-0.5 font-semibold">
                  {checkpoint.label} — {checkpoint.title}
                </h4>
                <p className="mt-1 text-sm text-fd-muted-foreground">{checkpoint.goal}</p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-fd-muted-foreground">
                  {checkpoint.ships.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="mt-2 text-sm">
                  <span className="font-semibold">
                    {isChapter(checkpoint) ? 'Proof. ' : 'Landed when. '}
                  </span>
                  <span className="text-fd-muted-foreground">{checkpoint.proof}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
