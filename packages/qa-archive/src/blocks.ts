/**
 * Markdown-lite: the small subset of markdown a support forum actually needs, parsed by hand.
 *
 * `apps/www` has no markdown dependency and gains none for this. The subset is deliberately tiny —
 * fences, lists, quotes, callouts, images, inline code and links — because everything a parser
 * accepts is something a stranger can type into the answer box, and the output is rendered by React
 * as text nodes rather than injected as HTML. There is no `dangerouslySetInnerHTML` on the far end,
 * so an unsupported construct renders as the literal characters instead of becoming markup.
 */

export type Span =
  { t: 'text'; v: string } | { t: 'code'; v: string } | { t: 'link'; v: string; href: string };

export type Block =
  | { kind: 'p'; spans: Span[] }
  | { kind: 'code'; lang?: string; code: string }
  | { kind: 'image'; src: string; alt: string; caption?: string }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'callout'; tone: 'note' | 'warn' | 'tip'; spans: Span[] };

const FENCE = /^```([a-z]*)\s*$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;
const UL = /^[-*]\s+(.*)$/;
const OL = /^\d+\.\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const CALLOUT = /^\[!(NOTE|WARNING|TIP)\]\s*(.*)$/;

/** `text`, [label](href) and everything else as literal text. */
export function parseSpans(text: string): Span[] {
  const spans: Span[] = [];
  let rest = text;
  // Inline code wins over links, so a backticked `[x](y)` stays literal.
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/;
  for (;;) {
    const m = pattern.exec(rest);
    if (!m) break;
    if (m.index > 0) spans.push({ t: 'text', v: rest.slice(0, m.index) });
    if (m[1] !== undefined) spans.push({ t: 'code', v: m[1] });
    else spans.push({ t: 'link', v: m[2]!, href: m[3]! });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) spans.push({ t: 'text', v: rest });
  return spans;
}

/**
 * Parse a body into blocks.
 *
 * An unclosed fence swallows the rest of the body as code rather than throwing. That is the right
 * failure for user-typed content: a half-written code block still reads as a code block, where a
 * thrown parse error would take the whole page down.
 */
export function parseBody(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'p', spans: parseSpans(para.join(' ').trim()) });
    para = [];
  };
  const flushList = () => {
    if (list)
      blocks.push({ kind: 'list', ordered: list.ordered, items: list.items.map(parseSpans) });
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const first = CALLOUT.exec(quote[0]!.trim());
    if (first) {
      const tone = first[1] === 'WARNING' ? 'warn' : first[1] === 'TIP' ? 'tip' : 'note';
      const body = [first[2] ?? '', ...quote.slice(1)].join(' ').trim();
      blocks.push({ kind: 'callout', tone, spans: parseSpans(body) });
    } else {
      blocks.push({ kind: 'quote', spans: parseSpans(quote.join(' ').trim()) });
    }
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line.trim());

    if (fence) {
      flushAll();
      const lang = fence[1] || undefined;
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!.trim())) code.push(lines[i++]!);
      blocks.push({ kind: 'code', lang, code: code.join('\n') });
      continue; // `i` is on the closing fence, or past the end for an unclosed one.
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const img = IMAGE.exec(line.trim());
    if (img) {
      flushAll();
      blocks.push({ kind: 'image', src: img[2]!, alt: img[1]!, caption: img[3] || undefined });
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]!);
      continue;
    }
    flushQuote();

    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul?.[1] ?? ol![1])!);
      continue;
    }
    flushList();

    para.push(line.trim());
  }

  flushAll();
  return blocks;
}

/** Plain text of a body, for excerpts and search. Code fences are dropped, not flattened. */
export function excerpt(text: string, max = 160): string {
  const words = parseBody(text)
    .filter((b) => b.kind === 'p')
    .map((b) => (b.kind === 'p' ? b.spans.map((s) => (s.t === 'link' ? s.v : s.v)).join('') : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (words.length <= max) return words;
  return words.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** Every image referenced by a body. Used by the validation test to check they exist on disk. */
export function imagesIn(text: string): { src: string; alt: string }[] {
  return parseBody(text)
    .filter((b): b is Extract<Block, { kind: 'image' }> => b.kind === 'image')
    .map(({ src, alt }) => ({ src, alt }));
}
