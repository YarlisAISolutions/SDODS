import type { Metadata } from 'next';
import Link from 'next/link';
import { PEOPLE_BY_REP, THREADS } from '@sdods/qa-archive';
import { Avatar, personLabel } from '@/components/qa/bits';

export const metadata: Metadata = {
  title: 'People',
  description: 'Everyone who asks and answers questions here.',
};

export default function UsersPage() {
  const counts = new Map<string, { asked: number; answered: number }>();
  for (const t of THREADS) {
    const q = counts.get(t.askedBy) ?? { asked: 0, answered: 0 };
    q.asked += 1;
    counts.set(t.askedBy, q);
    for (const a of t.answers) {
      const r = counts.get(a.by) ?? { asked: 0, answered: 0 };
      r.answered += 1;
      counts.set(a.by, r);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">People</h1>
      <p className="muted mt-3 max-w-2xl">
        The people who ask and answer here, ordered by reputation.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PEOPLE_BY_REP.map((p) => {
          const c = counts.get(p.handle) ?? { asked: 0, answered: 0 };
          return (
            <li key={p.handle} className="card flex gap-3 p-4">
              <Avatar handle={p.handle} size={44} />
              <div className="min-w-0">
                <Link
                  href={`/questions/users/${p.handle}/`}
                  className="font-medium hover:underline"
                >
                  {p.display}
                </Link>
                <p className="muted truncate text-xs">{p.tagline}</p>
                <p className="muted mt-1 text-xs tabular-nums">
                  {personLabel(p)} · {p.rep.toLocaleString()} · {c.asked} asked, {c.answered}{' '}
                  answered
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
