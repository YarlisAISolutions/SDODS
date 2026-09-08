import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { USE_CASES, excerpt } from '@sdods/qa-archive';
import { QaBody } from '@/components/qa/qa-body';
import { TagChip } from '@/components/qa/bits';

export const dynamicParams = false;

export function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const u = USE_CASES.find((c) => c.slug === slug);
  if (!u) return {};
  return { title: u.title, description: excerpt(u.problem, 155) };
}

export default async function UseCasePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const u = USE_CASES.find((c) => c.slug === slug);
  if (!u) notFound();

  const others = USE_CASES.filter((c) => c.slug !== u.slug).slice(0, 4);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/use-cases/" className="underline">
          ← All use cases
        </Link>
      </p>

      <p className="muted text-xs font-semibold uppercase tracking-wide">{u.surface}</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-3xl">{u.title}</h1>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {u.tags.map((tag) => (
          <TagChip key={tag} name={tag} />
        ))}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide">What makes it hard</h2>
      <QaBody body={u.problem} />

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide">How to cover it</h2>
      <QaBody body={u.approach} />

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide">Scenario sketch</h2>
      <QaBody body={u.sketch} />

      <section className="mt-12 border-t border-[var(--line)] pt-6">
        <h2 className="text-sm font-bold uppercase tracking-wide">Other use cases</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/questions/use-cases/${o.slug}/`} className="hover:underline">
                {o.title}
              </Link>
              <span className="muted ml-2 text-xs">{o.surface}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
