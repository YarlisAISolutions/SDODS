'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { excerpt } from '@sdods/qa-archive/blocks';
import {
  filterItems,
  formatDate,
  fromIndex,
  sortItems,
  type ListItem,
  type PersonChip,
  type QaIndex,
  type Sort,
} from '@/lib/qa-list';

/**
 * The questions list: search, tag filter and sort, all in the browser.
 *
 * Example threads show no votes, views or dates: those numbers were invented along with the
 * people, so they are not shown or offered as sort orders or filters (see ExampleNotice). Questions
 * asked on the site are real and keep their date.
 *
 * Two things this component deliberately does not do. It never imports `@sdods/qa-archive`, because
 * the archive belongs in the statically rendered pages, not in a bundle. And it never imports
 * `@/lib/questions` at the top level, because that pulls the Firestore SDK — several hundred
 * kilobytes — onto the critical path of the most-visited page in the section. Both arrive later,
 * over the network, and only when they are needed.
 */

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'unanswered', label: 'Unanswered' },
];

const PAGE = 30;

let indexPromise: Promise<QaIndex> | null = null;
function loadIndex(): Promise<QaIndex> {
  indexPromise ??= fetch('/questions/search-index.json').then((r) => {
    if (!r.ok) throw new Error(`search index: ${r.status}`);
    return r.json() as Promise<QaIndex>;
  });
  return indexPromise;
}

function Chip({ p }: { p: PersonChip | undefined }) {
  if (!p) return null;
  return (
    <span
      aria-hidden
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold"
      style={{ background: `hsl(${p.hue} 62% 88%)`, color: `hsl(${p.hue} 55% 28%)` }}
    >
      {p.initials}
    </span>
  );
}

function Row({ item, people }: { item: ListItem; people: Record<string, PersonChip> }) {
  const who = people[item.author];
  return (
    <li className="flex gap-4 py-4">
      <div className="muted hidden shrink-0 flex-row gap-3 pt-1 text-xs sm:flex">
        <span className="flex min-w-[3.25rem] flex-col items-center">
          <span className={`tabular-nums ${item.accepted ? 'font-semibold text-emerald-600' : ''}`}>
            {item.answers}
          </span>
          <span className="text-[0.7rem]">{item.answers === 1 ? 'answer' : 'answers'}</span>
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug">
          <Link href={item.href} className="hover:underline">
            {item.title}
          </Link>
          {item.source === 'live' && (
            <span className="muted ml-2 align-middle text-[0.65rem] font-normal uppercase tracking-wide">
              new
            </span>
          )}
        </h3>
        <p className="muted mt-1 line-clamp-2 text-sm">{item.excerpt}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <Link
                key={tag}
                href={`/questions/tags/${tag}/`}
                className="rounded bg-[var(--brand)]/10 px-2 py-0.5 text-xs text-[var(--brand)] hover:bg-[var(--brand)]/20"
              >
                {tag}
              </Link>
            ))}
          </div>
          <span className="muted inline-flex items-center gap-1.5 text-xs">
            <Chip p={who} />
            {who ? who.display : item.author}
            {who?.maintainer && (
              <span className="rounded bg-[var(--brand)]/12 px-1 text-[0.6rem] font-semibold uppercase text-[var(--brand)]">
                SDODS team
              </span>
            )}
            {item.source === 'live' && (
              <>
                {' · '}
                <time dateTime={item.date}>{formatDate(item.date)}</time>
              </>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

export function QaBrowser({
  initial,
  total,
  tags,
  people,
}: {
  initial: ListItem[];
  total: number;
  tags: string[];
  people: Record<string, PersonChip>;
}) {
  const [all, setAll] = useState<ListItem[] | null>(null);
  const [live, setLive] = useState<ListItem[]>([]);
  const [liveState, setLiveState] = useState<'idle' | 'checking' | 'found' | 'none'>('checking');
  const [merged, setMerged] = useState(false);

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('newest');
  const [shown, setShown] = useState(PAGE);

  const active = Boolean(query.trim() || tag) || sort !== 'newest';

  // The full index is only needed once somebody actually filters, so it is fetched at idle rather
  // than as part of the page load.
  useEffect(() => {
    let cancelled = false;
    const go = () => {
      loadIndex()
        .then((idx) => !cancelled && setAll(idx.items.map((r) => fromIndex(r, idx.tags))))
        .catch(() => {
          /* the server-rendered rows remain; filtering degrades to what is on the page */
        });
    };
    const w = window as unknown as { requestIdleCallback?: (cb: () => void) => number };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(go);
    else setTimeout(go, 400);
    return () => {
      cancelled = true;
    };
  }, []);

  // Firestore is imported here and nowhere else, so its bundle is fetched after paint.
  useEffect(() => {
    let cancelled = false;
    import('@/lib/questions')
      .then(({ listQuestions }) => listQuestions())
      .then((questions) => {
        if (cancelled) return;
        const items: ListItem[] = questions.map((q) => ({
          key: `live:${q.id}`,
          source: 'live',
          href: `/questions/live/?id=${encodeURIComponent(q.id)}`,
          slug: q.id,
          title: q.title,
          excerpt: excerpt(q.body, 180),
          author: q.name,
          date: (q.createdAt ?? new Date()).toISOString().slice(0, 10),
          tags: q.category === 'other' ? [] : [q.category],
          votes: null,
          answers: q.answers.filter((a) => !a.parentId).length,
          accepted: false,
          views: null,
        }));
        setLive(items);
        setLiveState(items.length ? 'found' : 'none');
      })
      .catch(() => !cancelled && setLiveState('none'));
    return () => {
      cancelled = true;
    };
  }, []);

  const pool = useMemo(() => {
    const base = all ?? initial;
    return merged ? [...base, ...live] : base;
  }, [all, initial, live, merged]);

  const results = useMemo(
    () => sortItems(filterItems(pool, { query, tag, from: '', to: '' }), sort),
    [pool, query, tag, sort],
  );

  const visible = active ? results.slice(0, shown) : results.slice(0, shown);
  const more = results.length - visible.length;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder={`Search ${total} questions — paste an error message`}
          aria-label="Search questions"
          className="!w-auto min-w-[14rem] flex-1 rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            setShown(PAGE);
          }}
          aria-label="Sort questions"
          className="!w-auto shrink-0 rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setTag(null)}
          className={`rounded px-2 py-0.5 text-xs ${
            tag === null
              ? 'bg-[var(--brand)] text-white'
              : 'bg-[var(--brand)]/10 text-[var(--brand)]'
          }`}
        >
          all
        </button>
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTag(tag === t ? null : t);
              setShown(PAGE);
            }}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${
              tag === t
                ? 'bg-[var(--brand)] text-white'
                : 'bg-[var(--brand)]/10 text-[var(--brand)] hover:bg-[var(--brand)]/20'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* A fixed-height strip, rendered in its resting state on the server. Live questions are
          never spliced in on their own: rows a reader is already looking at must not move. */}
      <div className="flex h-10 items-center justify-between gap-3 text-xs" role="status">
        <span className="muted">
          {active
            ? `${results.length} of ${pool.length} questions`
            : `${results.length === pool.length ? pool.length : `${visible.length} of ${pool.length}`} questions`}
          {all === null && ' · loading the rest…'}
        </span>
        {liveState === 'found' && !merged && (
          <button type="button" className="underline" onClick={() => setMerged(true)}>
            {live.length} new question{live.length === 1 ? '' : 's'} — show
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium">Nothing matches that.</p>
          <p className="muted mt-1 text-sm">
            Try fewer words, or clear the filters. If nobody has asked it yet, ask it.
          </p>
          <Link href="/questions/ask/" className="btn btn-primary mt-4">
            Ask a question
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {visible.map((item) => (
            <Row key={item.key} item={item} people={people} />
          ))}
        </ul>
      )}

      {more > 0 && (
        <div className="mt-6 text-center">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShown((n) => n + PAGE * 2)}
          >
            Show {Math.min(more, PAGE * 2)} more
          </button>
        </div>
      )}
    </div>
  );
}
