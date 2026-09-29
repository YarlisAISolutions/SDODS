import { describe, expect, it } from 'vitest';
import { applyFloor, canVote, netRep, planAccept, planVote } from '../src/reputation.js';

const vote = (
  kind: 'question' | 'answer',
  from: -1 | 0 | 1,
  to: -1 | 0 | 1,
  author: string | null = 'author',
) => planVote({ kind, authorUid: author, voterUid: 'voter', from, to });

describe('planVote', () => {
  it('+10 to the author of an upvoted question or answer', () => {
    expect(vote('question', 0, 1)).toEqual({
      scoreDelta: 1,
      rep: [{ uid: 'author', delta: 10, reason: 'upvoted' }],
    });
    expect(vote('answer', 0, 1).rep).toEqual([{ uid: 'author', delta: 10, reason: 'upvoted' }]);
  });

  it('a downvote costs the author 2, and the voter 1 when it is an answer', () => {
    expect(vote('question', 0, -1).rep).toEqual([
      { uid: 'author', delta: -2, reason: 'downvoted' },
    ]);
    expect(netRep(vote('answer', 0, -1).rep)).toEqual(
      new Map([
        ['author', -2],
        ['voter', -1],
      ]),
    );
  });

  it('changing a vote reverses the old one completely', () => {
    const flip = vote('answer', 1, -1);
    expect(flip.scoreDelta).toBe(-2);
    expect(netRep(flip.rep)).toEqual(
      new Map([
        ['author', -12],
        ['voter', -1],
      ]),
    );
    const undo = vote('answer', -1, 0);
    expect(undo.scoreDelta).toBe(1);
    expect(netRep(undo.rep)).toEqual(
      new Map([
        ['author', 2],
        ['voter', 1],
      ]),
    );
  });

  it('moves the score but gives no reputation when the author is unknown', () => {
    expect(vote('question', 0, 1, null)).toEqual({ scoreDelta: 1, rep: [] });
  });
});

describe('planAccept', () => {
  const a = (id: string, author: string | null) => ({ answerId: id, authorUid: author });

  it('+15 to the answerer and +2 to the asker', () => {
    expect(netRep(planAccept({ askerUid: 'asker', from: null, to: a('x', 'ans') }))).toEqual(
      new Map([
        ['ans', 15],
        ['asker', 2],
      ]),
    );
  });

  it('switching the accepted answer moves the 15, and the asker keeps their 2', () => {
    expect(
      netRep(planAccept({ askerUid: 'asker', from: a('x', 'one'), to: a('y', 'two') })),
    ).toEqual(
      new Map([
        ['one', -15],
        ['two', 15],
      ]),
    );
  });

  it('un-accepting reverses both', () => {
    expect(netRep(planAccept({ askerUid: 'asker', from: a('x', 'ans'), to: null }))).toEqual(
      new Map([
        ['ans', -15],
        ['asker', -2],
      ]),
    );
  });

  it('accepting your own answer earns nothing', () => {
    expect(planAccept({ askerUid: 'asker', from: null, to: a('x', 'asker') })).toEqual([]);
  });

  it('re-accepting the same answer changes nothing', () => {
    expect(planAccept({ askerUid: 'asker', from: a('x', 'ans'), to: a('x', 'ans') })).toEqual([]);
  });
});

describe('floor and privileges', () => {
  it('reputation never drops below 1', () => {
    expect(applyFloor(1, -2)).toBe(1);
    expect(applyFloor(20, -2)).toBe(18);
  });

  it('upvoting needs 15 and downvoting 125, withdrawing a vote needs nothing, editors are exempt', () => {
    expect(canVote(1, 14, 'member')).toEqual({ ok: false, need: 15 });
    expect(canVote(1, 15, 'member')).toEqual({ ok: true });
    expect(canVote(-1, 124, 'member')).toEqual({ ok: false, need: 125 });
    expect(canVote(0, 1, 'member')).toEqual({ ok: true });
    expect(canVote(-1, 1, 'editor')).toEqual({ ok: true });
  });
});
