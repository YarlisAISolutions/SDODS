import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imagesIn } from './blocks';
import { HANDLES, PEOPLE } from './people';
import { TAG_NAMES } from './tags';
import { THREADS } from './index';
import { USE_CASES } from './use-cases';

/**
 * The archive is 300 threads written by many hands. Every rule below exists because breaking it
 * produces a page that is wrong rather than a build that fails, which is the worst kind of defect
 * for content: nothing complains, and the site is subtly broken until a person notices.
 */

const WWW_PUBLIC = resolve(import.meta.dirname, '../../../apps/www/public');

/** The archive claims a six-year history. The upper bound is a frozen date, not "now" — a thread
 *  dated tomorrow is a bug, and bumping this should be a deliberate edit. */
const FIRST_DAY = '2020-09-01';
const LAST_DAY = '2026-09-07';

/** Sibling routes under /questions/. A thread slugged `tags` would fight app/questions/tags/ for
 *  the same out/questions/tags/index.html, and the export would silently lose one of them. */
const RESERVED = new Set(['ask', 'tags', 'users', 'use-cases', 'live', 'search-index.json']);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const allBodies = THREADS.flatMap((t) => [t.body, ...t.answers.map((a) => a.body)]);

describe('threads', () => {
  it('has the archive it claims to have', () => {
    expect(THREADS.length).toBeGreaterThanOrEqual(300);
  });

  it('gives every thread a unique, URL-safe slug that no sibling route claims', () => {
    const seen = new Set<string>();
    for (const t of THREADS) {
      expect(t.slug, `${t.slug} is not a URL-safe slug`).toMatch(SLUG);
      expect(t.slug.length, `${t.slug} is too long for a directory name`).toBeLessThanOrEqual(80);
      expect(RESERVED.has(t.slug), `${t.slug} collides with a route under /questions/`).toBe(false);
      expect(seen.has(t.slug), `${t.slug} is used twice`).toBe(false);
      seen.add(t.slug);
    }
  });

  it('tags every thread from the closed vocabulary, without repeats', () => {
    for (const t of THREADS) {
      expect(t.tags.length, `${t.slug} has no tags`).toBeGreaterThan(0);
      expect(t.tags.length, `${t.slug} has too many tags to read`).toBeLessThanOrEqual(4);
      expect(new Set(t.tags).size, `${t.slug} repeats a tag`).toBe(t.tags.length);
      for (const tag of t.tags) expect(TAG_NAMES, `${t.slug}: unknown tag ${tag}`).toContain(tag);
    }
  });

  it('attributes every post to somebody in the cast', () => {
    for (const t of THREADS) {
      expect(HANDLES, `${t.slug}: unknown author`).toContain(t.askedBy);
      for (const a of t.answers)
        expect(HANDLES, `${t.slug}/${a.id}: unknown answerer`).toContain(a.by);
    }
  });

  it('never lets an answer predate its question, or anyone post before they joined', () => {
    const joined = new Map(PEOPLE.map((p) => [p.handle, p.joined as string]));
    for (const t of THREADS) {
      expect(
        t.askedOn >= joined.get(t.askedBy)!,
        `${t.slug} was asked before ${t.askedBy} joined`,
      ).toBe(true);
      for (const a of t.answers) {
        expect(a.on >= t.askedOn, `${t.slug}/${a.id} answers before the question was asked`).toBe(
          true,
        );
        expect(a.on >= joined.get(a.by)!, `${t.slug}/${a.id}: ${a.by} had not joined yet`).toBe(
          true,
        );
      }
    }
  });

  it('keeps every date inside the six years the archive covers', () => {
    for (const t of THREADS) {
      expect(t.askedOn, `${t.slug} has a malformed date`).toMatch(DATE);
      expect(
        t.askedOn >= FIRST_DAY && t.askedOn <= LAST_DAY,
        `${t.slug} is dated ${t.askedOn}`,
      ).toBe(true);
      for (const a of t.answers) {
        expect(a.on, `${t.slug}/${a.id} has a malformed date`).toMatch(DATE);
        expect(a.on >= FIRST_DAY && a.on <= LAST_DAY, `${t.slug}/${a.id} is dated ${a.on}`).toBe(
          true,
        );
      }
    }
  });

  it('accepts exactly one answer per answered thread, and none on an unanswered one', () => {
    for (const t of THREADS) {
      const ids = t.answers.map((a) => a.id);
      expect(new Set(ids).size, `${t.slug} reuses an answer id`).toBe(ids.length);
      expect(t.answers.length, `${t.slug} has too many answers`).toBeLessThanOrEqual(4);
      if (t.acceptedAnswerId) {
        expect(ids, `${t.slug} accepts an answer that is not on it`).toContain(t.acceptedAnswerId);
      } else if (t.answers.length === 0) {
        expect(t.acceptedAnswerId).toBeUndefined();
      }
    }
  });

  // A forum where every question is answered does not read like a forum, and the "unanswered"
  // filter needs something to find.
  it('leaves some questions unanswered', () => {
    const unanswered = THREADS.filter((t) => t.answers.length === 0);
    expect(unanswered.length).toBeGreaterThanOrEqual(12);
    expect(unanswered.length).toBeLessThan(THREADS.length * 0.15);
  });

  it('writes a real body for every post', () => {
    for (const t of THREADS) {
      expect(t.body.trim().length, `${t.slug} has an empty body`).toBeGreaterThan(40);
      expect(t.title.trim().length, `${t.slug} has no title`).toBeGreaterThan(10);
      expect(t.title.length, `${t.slug} has a title too long to render`).toBeLessThanOrEqual(160);
      for (const a of t.answers) {
        expect(a.body.trim().length, `${t.slug}/${a.id} has an empty answer`).toBeGreaterThan(30);
      }
    }
  });
});

describe('the six-year history holds together', () => {
  // SDODS's own artefacts are all recent. A 2021 thread quoting a version number, a package
  // channel or a tracker defect contradicts itself on the first careful read.
  // Names SDODS's own release channels rather than the bare word "docker": somebody running
  // *their own app* under docker compose in 2023 says nothing about how SDODS was distributed.
  const DISTRIBUTION =
    /ghcr\.io|sdods-server|homebrew|brew (install|tap)|scoop (bucket|install)|winget|apt(-get)? install sdods|sdods-archive-keyring|gatekeeper|smartscreen|notariz|docker (run|pull)[^\n]*sdods/i;
  // The lookarounds keep an IP address out of this: 127.0.0.1 is not a release of anything.
  const VERSION = /(?<![\d.])\d+\.\d+\.\d+(?![\d.])|@sdods\/\w+@\d|\bv\d+\.\d+\b/;

  const early = () => THREADS.filter((t) => t.askedOn < '2026-01-01');

  it('quotes no version number before 2026', () => {
    for (const t of early()) {
      for (const body of [t.body, ...t.answers.map((a) => a.body)]) {
        expect(VERSION.test(body), `${t.slug} (${t.askedOn}) quotes a version`).toBe(false);
      }
    }
  });

  it('keeps every distribution-channel topic in 2026', () => {
    for (const t of early()) {
      const text = [t.title, t.body, ...t.answers.map((a) => a.body)].join('\n');
      expect(DISTRIBUTION.test(text), `${t.slug} (${t.askedOn}) discusses a package channel`).toBe(
        false,
      );
    }
  });

  it('ramps in volume towards the present rather than sitting flat', () => {
    const perYear = new Map<string, number>();
    for (const t of THREADS)
      perYear.set(t.askedOn.slice(0, 4), (perYear.get(t.askedOn.slice(0, 4)) ?? 0) + 1);
    expect([...perYear.keys()].sort()).toEqual([
      '2020',
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
    ]);
    expect(perYear.get('2020')!).toBeLessThan(perYear.get('2025')!);
    expect(perYear.get('2021')!).toBeLessThan(perYear.get('2026')!);
  });
});

describe('nothing points at something that is not there', () => {
  it('references only images that exist under apps/www/public', () => {
    for (const body of allBodies) {
      for (const img of imagesIn(body)) {
        expect(img.alt.trim().length, `${img.src} has no alt text`).toBeGreaterThan(0);
        expect(existsSync(join(WWW_PUBLIC, img.src)), `${img.src} is not on disk`).toBe(true);
      }
    }
  });

  it('leaves no tag page empty', () => {
    for (const tag of TAG_NAMES) {
      const n = THREADS.filter((t) => (t.tags as readonly string[]).includes(tag)).length;
      expect(n, `no thread is tagged ${tag}`).toBeGreaterThan(0);
    }
  });

  it('leaves no profile page empty', () => {
    for (const p of PEOPLE) {
      const posts = THREADS.filter(
        (t) => t.askedBy === p.handle || t.answers.some((a) => a.by === p.handle),
      ).length;
      expect(posts, `${p.handle} has no posts`).toBeGreaterThan(0);
    }
  });

  // There is no dangerouslySetInnerHTML on the far end, so this is belt and braces — but a body
  // carrying markup means somebody expected it to render, and it will not.
  it('carries no HTML in a body', () => {
    for (const body of allBodies) {
      const outsideFences = body.replace(/```[\s\S]*?```/g, '');
      expect(/<script|<iframe|<img\s|<div/i.test(outsideFences)).toBe(false);
    }
  });
});

describe('use cases', () => {
  it('are present, slugged and tagged like everything else', () => {
    expect(USE_CASES.length).toBeGreaterThanOrEqual(8);
    const seen = new Set<string>();
    for (const u of USE_CASES) {
      expect(u.slug).toMatch(SLUG);
      expect(seen.has(u.slug), `${u.slug} is used twice`).toBe(false);
      seen.add(u.slug);
      for (const tag of u.tags) expect(TAG_NAMES, `${u.slug}: unknown tag ${tag}`).toContain(tag);
      expect(u.problem.trim().length).toBeGreaterThan(40);
      expect(u.approach.trim().length).toBeGreaterThan(40);
      expect(u.sketch.trim().length).toBeGreaterThan(20);
    }
  });
});

describe('the cast', () => {
  it('is large enough and internally consistent', () => {
    expect(PEOPLE.length).toBeGreaterThanOrEqual(40);
    expect(new Set(HANDLES).size).toBe(HANDLES.length);
    for (const p of PEOPLE) {
      expect(p.handle).toMatch(SLUG);
      expect(p.joined).toMatch(DATE);
      expect(
        p.joined >= '2020-06-01' && p.joined <= LAST_DAY,
        `${p.handle} joined ${p.joined}`,
      ).toBe(true);
    }
  });
});
