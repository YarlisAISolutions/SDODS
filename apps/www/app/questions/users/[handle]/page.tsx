import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HANDLES, person, threadsByPerson } from '@sdods/qa-archive';
import { Avatar, ExampleNotice, personLabel } from '@/components/qa/bits';
import { ThreadList } from '@/components/qa/thread-list';

export const dynamicParams = false;

export function generateStaticParams() {
  return HANDLES.map((handle) => ({ handle }));
}

export async function generateMetadata(props: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await props.params;
  const p = person(handle);
  if (!p) return {};
  return {
    title: p.display,
    description: `${p.display} (illustrative) — ${p.tagline}`,
  };
}

export default async function UserPage(props: { params: Promise<{ handle: string }> }) {
  const { handle } = await props.params;
  const p = person(handle);
  if (!p) notFound();
  const { asked, answered } = threadsByPerson(handle);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/users/" className="underline">
          ← All people
        </Link>
      </p>

      <header className="flex flex-wrap items-center gap-4">
        <Avatar handle={p.handle} size={64} />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{p.display}</h1>
          <p className="muted mt-1 text-sm">{p.tagline}</p>
          <p className="muted mt-1 text-xs tabular-nums">{personLabel(p)}</p>
        </div>
      </header>
      <div className="mt-6">
        <ExampleNotice compact />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-bold uppercase tracking-wide">Asked ({asked.length})</h2>
        {asked.length === 0 ? (
          <p className="muted mt-3 text-sm">Nothing yet.</p>
        ) : (
          <div className="mt-3">
            <ThreadList threads={asked} />
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-bold uppercase tracking-wide">Answered ({answered.length})</h2>
        {answered.length === 0 ? (
          <p className="muted mt-3 text-sm">Nothing yet.</p>
        ) : (
          <div className="mt-3">
            <ThreadList threads={answered} />
          </div>
        )}
      </section>
    </div>
  );
}
