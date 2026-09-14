/**
 * The small Markdown subset a chat answer uses, parsed into plain data and rendered as React
 * elements (never as HTML strings). Built for text that is still streaming: an unclosed code fence
 * is simply a code block that has not ended yet.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'code'; lang: string; text: string; open: boolean }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

/** Only web links and in-site paths; `javascript:`, `data:` and the rest render as plain text. */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  if (/^https?:\/\//i.test(h) || h.startsWith('/') || h.startsWith('#')) return h;
  return undefined;
}

const INLINE =
  /(`+)([\s\S]*?)\1|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*(?!\s)([^*]+?)\*|(?<![\w])_(?!\s)([^_]+?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    last = index + m[0].length;
    if (m[1] !== undefined) out.push({ type: 'code', text: m[2]!.trim() || m[2]! });
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push({ type: 'strong', children: parseInline(m[3] ?? m[4]!) });
    else if (m[5] !== undefined || m[6] !== undefined)
      out.push({ type: 'em', children: parseInline(m[5] ?? m[6]!) });
    else if (m[7] !== undefined) {
      const href = safeHref(m[8]!);
      if (href) out.push({ type: 'link', href, children: parseInline(m[7]) });
      else out.push({ type: 'text', text: m[7] });
    } else if (m[9] !== undefined)
      out.push({ type: 'link', href: m[9], children: [{ type: 'text', text: m[9] }] });
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()));

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      let open = true;
      for (i++; i < lines.length; i++) {
        if (lines[i]!.trim().startsWith(marker) && lines[i]!.trim().replace(/[`~]/g, '') === '') {
          open = false;
          break;
        }
        body.push(lines[i]!);
      }
      blocks.push({ type: 'code', lang: fence[2] ?? '', text: body.join('\n'), open });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        children: parseInline(heading[2]!),
      });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(line);
      const rows: Inline[][][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++)
        rows.push(splitRow(lines[i]!));
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = item[2] !== undefined;
      const items: string[] = [item[3]!];
      for (i++; i < lines.length; i++) {
        const next = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(lines[i]!);
        if (next && (next[2] !== undefined) === ordered) items.push(next[3]!);
        else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length)
          items[items.length - 1] += `\n${lines[i]!.trim()}`;
        else break;
      }
      i--;
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
