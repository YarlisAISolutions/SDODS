import type { Metadata } from 'next';
import Link from 'next/link';
import { USE_CASES, excerpt } from '@sdods/qa-archive';
import { TagChip } from '@/components/qa/bits';

export const metadata: Metadata = {
  title: 'Use cases',
  description:
    'Hard surfaces to test — auth without selectors, plan caps, a drag canvas, cached denials — and what a scenario for each actually looks like.',
};

/**
 * The counterpart to the questions list. These are not questions anyone asked; they are surfaces
 * that resist testing, written up with what SDODS can do about each — including, where the answer
 * is "not yet", saying so rather than implying a capability that does not exist.
 *
 * An index rather than one long page: twelve of these inline came to twenty-odd thousand pixels,
 * which is a scroll nobody finishes and a single URL nobody can link to a colleague.
 */
export default function UseCasesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/" className="underline">
          ← All questions
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Use cases</h1>
      <p className="muted mt-3 max-w-2xl">
        Surfaces that are genuinely hard to cover — a sign-up flow with no stable selectors, a plan
        cap that reports the wrong error, a drag-and-drop canvas — and what a scenario for each
        actually looks like. Where SDODS cannot do it yet, that is said outright.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {USE_CASES.map((u) => (
          <li key={u.slug} className="card flex flex-col p-5">
            <p className="muted text-xs font-semibold uppercase tracking-wide">{u.surface}</p>
            <h2 className="mt-1 font-semibold leading-snug">
              <Link href={`/questions/use-cases/${u.slug}/`} className="hover:underline">
                {u.title}
              </Link>
            </h2>
            <p className="muted mt-2 flex-1 text-sm">{excerpt(u.problem, 150)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {u.tags.map((tag) => (
                <TagChip key={tag} name={tag} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
