import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TAG_NAMES, tagInfo, threadsByTag, type Tag } from '@sdods/qa-archive';
import { ThreadList } from '@/components/qa/thread-list';

export const dynamicParams = false;

export function generateStaticParams() {
  return TAG_NAMES.map((tag) => ({ tag }));
}

export async function generateMetadata(props: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await props.params;
  const info = tagInfo(tag);
  if (!info) return {};
  return { title: `Questions tagged ${tag}`, description: info.blurb };
}

export default async function TagPage(props: { params: Promise<{ tag: string }> }) {
  const { tag } = await props.params;
  const info = tagInfo(tag);
  if (!info) notFound();
  const threads = threadsByTag(tag as Tag);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <p className="muted mb-4 text-sm">
        <Link href="/questions/tags/" className="underline">
          ← All tags
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">
        Questions tagged <span className="text-[var(--brand)]">{tag}</span>
      </h1>
      <p className="muted mt-3 max-w-2xl">{info.blurb}</p>
      <p className="muted mt-1 text-sm tabular-nums">
        {threads.length} question{threads.length === 1 ? '' : 's'}
      </p>

      <div className="mt-8">
        <ThreadList threads={threads} activeTag={tag} />
      </div>
    </div>
  );
}
