import Link from 'next/link';
import { excerpt, type Thread } from '@sdods/qa-archive';
import { Byline, Stat, TagChip } from '@/components/qa/bits';

/** One question in a list: counts on the left, title and tags in the middle, byline underneath. */
export function ThreadRow({ thread, activeTag }: { thread: Thread; activeTag?: string }) {
  return (
    <li className="flex gap-4 py-4">
      <div className="muted hidden shrink-0 flex-row gap-3 pt-1 text-xs sm:flex">
        <Stat n={thread.votes} label="votes" />
        <Stat
          n={thread.answers.length}
          label={thread.answers.length === 1 ? 'answer' : 'answers'}
          strong={Boolean(thread.acceptedAnswerId)}
        />
        <Stat n={thread.views} label="views" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold leading-snug">
          <Link href={`/questions/${thread.slug}/`} className="hover:underline">
            {thread.title}
          </Link>
        </h2>
        <p className="muted mt-1 line-clamp-2 text-sm">{excerpt(thread.body, 180)}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {thread.tags.map((tag) => (
              <TagChip key={tag} name={tag} active={tag === activeTag} />
            ))}
          </div>
          <Byline handle={thread.askedBy} date={thread.askedOn} action="asked by" />
        </div>
      </div>
    </li>
  );
}
