/**
 * Emits the compact search index the questions list filters over.
 *
 * The list page must search the whole archive without shipping it. Passing the archive as props
 * would inline it into every export artefact Next writes for that route — four copies on disk and a
 * six-figure byte count on the critical path of the busiest page — so the index is written to
 * `public/` instead and fetched once, at idle, only when a filter is actually used.
 *
 * Generated. Do not edit the output by hand; run `bun run qa:index`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SUMMARIES, TAG_NAMES } from '@sdods/qa-archive';

const OUT = resolve(import.meta.dirname, '../apps/www/public/questions/search-index.json');

/** Short keys and tag indexes rather than repeated strings: the file is downloaded, not read. */
export interface IndexRecord {
  s: string;
  t: string;
  x: string;
  g: number[];
  d: string;
  a: string;
  v: number;
  n: number;
  k: 0 | 1;
  w: number;
}

export interface QaIndex {
  tags: string[];
  items: IndexRecord[];
}

export function buildIndex(): QaIndex {
  const tags = [...TAG_NAMES];
  return {
    tags,
    items: SUMMARIES.map((s) => ({
      s: s.slug,
      t: s.title,
      x: s.excerpt,
      g: s.tags.map((t) => tags.indexOf(t)).filter((i) => i >= 0),
      d: s.askedOn,
      a: s.askedBy,
      v: s.votes,
      n: s.answers,
      k: s.accepted ? 1 : 0,
      w: s.views,
    })),
  };
}

function main() {
  const index = buildIndex();
  const json = JSON.stringify(index);
  const check = process.argv.includes('--check');

  if (check) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      /* not written yet */
    }
    if (current !== json) {
      console.error(
        'apps/www/public/questions/search-index.json is stale. Run `bun run qa:index`.',
      );
      process.exit(1);
    }
    console.log(`search index is current (${index.items.length} questions)`);
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(
    `wrote ${join('apps/www/public/questions', 'search-index.json')} — ${index.items.length} questions, ${(json.length / 1024).toFixed(1)} kB`,
  );
}

if (import.meta.filename === process.argv[1]) main();
