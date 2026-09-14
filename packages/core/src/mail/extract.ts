import type { MailMessage } from './types.js';

/**
 * Pure helpers over a fetched message: its readable text, its links and a code in it. Kept apart
 * from the steps so the parsing, which fails quietly when wrong, is testable on its own.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode the HTML entities that show up in hrefs and body text: named basics and numeric. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1]?.toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ref.toLowerCase()] ?? m;
  });
}

/** The HTML part as plain text: scripts and styles dropped, tags removed, whitespace collapsed. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Everything a reader could see: the text part, then the HTML part rendered to text. */
export function readableText(m: Pick<MailMessage, 'text' | 'html'>): string {
  return [m.text, m.html ? htmlToText(m.html) : ''].filter(Boolean).join('\n');
}

export interface MailLink {
  href: string;
  /** Visible text of the anchor; empty for a URL found in the text part. */
  text: string;
}

/** Trailing punctuation that ends a sentence rather than a URL. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

/**
 * Links in the message. Anchors in the HTML part come first, with `&amp;` and friends decoded
 * (an href is HTML-escaped, and a verify link with `?token=…&amp;email=…` is the common case).
 * URLs in the text part follow, so a text-only message still has links; duplicates are dropped.
 */
export function extractLinks(m: Pick<MailMessage, 'text' | 'html'>): MailLink[] {
  const out: MailLink[] = [];
  const seen = new Set<string>();
  const add = (href: string, text: string) => {
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ href, text });
  };
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of m.html.matchAll(anchor)) {
    const href = decodeEntities((match[1] ?? match[2] ?? match[3] ?? '').trim());
    if (/^(mailto:|tel:|#|javascript:)/i.test(href)) continue;
    add(href, htmlToText(match[4] ?? ''));
  }
  for (const match of m.text.matchAll(/https?:\/\/[^\s<>"]+/gi)) {
    add(match[0].replace(TRAILING, ''), '');
  }
  return out;
}

/** Compile a scenario's pattern; one that is not a valid regular expression is matched literally. */
export function toPattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  }
}

/**
 * The first link whose href contains `pattern` literally or matches it as a regular expression.
 * Both, because a URL is the natural thing to write and its `?` and `.` are regex syntax:
 * `https://app.test/verify?token=` is a valid regex that does NOT match its own text.
 */
export function findLinkMatching(
  m: Pick<MailMessage, 'text' | 'html'>,
  pattern: string,
): MailLink | undefined {
  const re = toPattern(pattern);
  return extractLinks(m).find((l) => l.href.includes(pattern) || re.test(l.href));
}

/**
 * The link a person would click by name: an anchor whose visible text equals `name`
 * (case-insensitive, whitespace-normalised), else one whose text contains it, else one whose href
 * contains it.
 */
export function findLinkNamed(
  m: Pick<MailMessage, 'text' | 'html'>,
  name: string,
): MailLink | undefined {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const wanted = norm(name);
  const links = extractLinks(m);
  return (
    links.find((l) => norm(l.text) === wanted) ??
    links.find((l) => wanted !== '' && norm(l.text).includes(wanted)) ??
    links.find((l) => l.href.includes(name))
  );
}

/**
 * The first match of `pattern` in the readable text: capture group 1 when the pattern has one,
 * the whole match otherwise. `code: (\d{6})` saves the six digits, `\d{6}` saves the same.
 */
export function findCode(
  m: Pick<MailMessage, 'text' | 'html'>,
  pattern: string,
): string | undefined {
  const match = toPattern(pattern).exec(readableText(m));
  if (!match) return undefined;
  return match[1] ?? match[0];
}
