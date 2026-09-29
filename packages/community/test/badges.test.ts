import { describe, expect, it } from 'vitest';
import { forAccepting, forEditing, forScore, forVoting, readBadges } from '../src/badges.js';

const at = new Date('2026-09-29T00:00:00Z');
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('forScore', () => {
  it('Student for a first upvoted question, Teacher for a first upvoted answer', () => {
    expect(
      ids(forScore({ kind: 'question', score: 1, accepted: false, post: 'q', have: [], at })),
    ).toEqual(['student']);
    expect(
      ids(forScore({ kind: 'answer', score: 1, accepted: false, post: 'a', have: [], at })),
    ).toEqual(['teacher']);
  });

  it('Nice, Good and Great at 10, 25 and 100, each once per post', () => {
    const have = forScore({ kind: 'answer', score: 25, accepted: false, post: 'a1', have: [], at });
    expect(ids(have)).toEqual(['teacher', 'nice-answer', 'good-answer']);
    expect(forScore({ kind: 'answer', score: 26, accepted: false, post: 'a1', have, at })).toEqual(
      [],
    );
    // Another post earns its own Nice Answer.
    expect(
      ids(forScore({ kind: 'answer', score: 10, accepted: false, post: 'a2', have, at })),
    ).toEqual(['nice-answer']);
  });

  it('Guru needs an accepted answer with a score of 40', () => {
    expect(
      ids(forScore({ kind: 'answer', score: 40, accepted: false, post: 'a', have: [], at })),
    ).not.toContain('accepted-guru');
    expect(
      ids(forScore({ kind: 'answer', score: 40, accepted: true, post: 'a', have: [], at })),
    ).toContain('accepted-guru');
  });

  it('tags each award with its tier and, for per-post badges, the post', () => {
    const [nice] = forScore({
      kind: 'question',
      score: 10,
      accepted: false,
      post: 'q9',
      have: [{ id: 'student', tier: 'bronze', at: '' }],
      at,
    });
    expect(nice).toEqual({ id: 'nice-question', tier: 'bronze', post: 'q9', at: at.toISOString() });
  });
});

describe('one-off badges', () => {
  it('Supporter and Critic for a first up and down vote, once', () => {
    const s = forVoting(1, [], at);
    expect(ids(s)).toEqual(['supporter']);
    expect(forVoting(1, s, at)).toEqual([]);
    expect(ids(forVoting(-1, s, at))).toEqual(['critic']);
    expect(forVoting(0, [], at)).toEqual([]);
  });

  it('Scholar for accepting, Editor for editing, once each', () => {
    expect(ids(forAccepting([], at))).toEqual(['scholar']);
    const e = forEditing([], at);
    expect(ids(e)).toEqual(['editor']);
    expect(forEditing(e, at)).toEqual([]);
  });
});

describe('readBadges', () => {
  it('drops anything that is not a known badge', () => {
    expect(
      readBadges([{ id: 'student', tier: 'bronze', at: 'x' }, { id: 'fake' }, 'junk', null]),
    ).toEqual([{ id: 'student', tier: 'bronze', at: 'x' }]);
    expect(readBadges(undefined)).toEqual([]);
  });
});
