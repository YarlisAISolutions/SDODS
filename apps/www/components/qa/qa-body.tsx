import { parseBody, type Block, type Span } from '@sdods/qa-archive/blocks';
import { CopyButton } from '@/components/copy-button';

/**
 * Renders a markdown-lite body.
 *
 * A server component with no `dangerouslySetInnerHTML` anywhere: every string arrives as a React
 * text node, so a body typed by a stranger into the answer box cannot become markup. That is the
 * whole reason the archive and the moderated live answers share one parser and one renderer —
 * there is no second path with weaker rules.
 */

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.t === 'code')
          return (
            <code key={i} className="rounded bg-[var(--line)] px-1 py-0.5 text-[0.9em]">
              {s.v}
            </code>
          );
        if (s.t === 'link')
          return (
            <a key={i} href={s.href} className="underline underline-offset-2">
              {s.v}
            </a>
          );
        return <span key={i}>{s.v}</span>;
      })}
    </>
  );
}

const CALLOUT_STYLE = {
  note: 'border-l-4 border-[var(--brand)] bg-[var(--brand)]/5',
  warn: 'border-l-4 border-amber-500 bg-amber-500/5',
  tip: 'border-l-4 border-[var(--brand-2)] bg-[var(--brand-2)]/10',
} as const;

function One({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return (
        <p className="my-3 leading-relaxed">
          <Spans spans={block.spans} />
        </p>
      );

    case 'code':
      return (
        <div className="my-4 overflow-hidden rounded-lg border border-[var(--line)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-1.5">
            <span className="muted font-mono text-xs">{block.lang ?? 'text'}</span>
            <CopyButton text={block.code} label="Copy" what="code block" />
          </div>
          {/* `pre` is styled globally with its own radius and padding; both are dropped here so the
              block meets the container's edges instead of floating inside it. Wide output scrolls in
              its own box, so the page itself never scrolls sideways. */}
          <pre className="!m-0 !rounded-none overflow-x-auto !px-4 !py-3 !text-xs">
            <code>{block.code}</code>
          </pre>
        </div>
      );

    case 'image':
      return (
        <figure className="my-4">
          <img
            src={block.src}
            alt={block.alt}
            loading="lazy"
            className="rounded-lg border border-[var(--line)]"
          />
          {block.caption && <figcaption className="muted mt-2 text-xs">{block.caption}</figcaption>}
        </figure>
      );

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`my-3 ml-5 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      );
    }

    case 'quote':
      return (
        <blockquote className="muted my-4 border-l-4 border-[var(--line)] pl-4 italic">
          <Spans spans={block.spans} />
        </blockquote>
      );

    case 'callout':
      return (
        <div className={`my-4 rounded-r-lg px-4 py-3 text-sm ${CALLOUT_STYLE[block.tone]}`}>
          <Spans spans={block.spans} />
        </div>
      );
  }
}

export function QaBody({ body }: { body: string }) {
  const blocks = parseBody(body);
  return (
    <div className="text-[0.95rem]">
      {blocks.map((block, i) => (
        <One key={i} block={block} />
      ))}
    </div>
  );
}
