import { describe, expect, it } from 'vitest';
import { THREADS } from '@sdods/qa-archive';
import { buildIndex } from '../scripts/build-qa-index';

/**
 * The search index is downloaded by every visitor who filters the questions list, so its size is a
 * budget rather than an afterthought: a body change that quietly tripled it would otherwise ship
 * unnoticed.
 */
describe('the questions search index', () => {
  const index = buildIndex();

  it('has one record per thread, and every slug is real', () => {
    expect(index.items).toHaveLength(THREADS.length);
    const slugs = new Set(THREADS.map((t) => t.slug));
    for (const item of index.items)
      expect(slugs.has(item.s), `${item.s} is not a thread`).toBe(true);
  });

  it('carries excerpts, not bodies', () => {
    for (const item of index.items) {
      expect(item.x.length, `${item.s} has an over-long excerpt`).toBeLessThanOrEqual(161);
      expect(item.x, `${item.s} leaked a code fence into its excerpt`).not.toContain('```');
    }
  });

  it('resolves every tag index against the header', () => {
    for (const item of index.items) {
      for (const g of item.g)
        expect(index.tags[g], `${item.s} has an unresolvable tag`).toBeTruthy();
    }
  });

  it('stays inside its download budget', () => {
    expect(JSON.stringify(index).length).toBeLessThan(200_000);
  });
});
