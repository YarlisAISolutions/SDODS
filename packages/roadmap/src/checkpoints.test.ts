import { describe, expect, it } from 'vitest';
import { CHECKPOINTS, TODAY_ID } from './checkpoints';
import { LADDER } from './ladder';
import { ROADMAP } from './compat';
import { isChapter, isMonth, isYear } from './types';

describe('roadmap checkpoints', () => {
  it('marks exactly one stop as today, and it is the one the road points at', () => {
    const now = CHECKPOINTS.filter((c) => c.state === 'now');
    expect(now).toHaveLength(1);
    expect(now[0]!.id).toBe(TODAY_ID);
  });

  it('runs twelve contiguous months', () => {
    const months = CHECKPOINTS.filter(isMonth).map((m) => m.when);
    expect(months).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
    ]);
  });

  it('groups all fourteen phases into chapters exactly once', () => {
    expect(ROADMAP.map((p) => p.phase)).toEqual([...Array(14).keys()]);
    expect(ROADMAP.every((p) => p.status === 'done')).toBe(true);
  });

  it('orders the chapters and leaves them undated', () => {
    const chapters = CHECKPOINTS.filter(isChapter);
    expect(chapters.map((c) => c.order)).toEqual([1, 2, 3, 4, 5]);
    // A delivered chapter carries no date on purpose; there is no release history to date it against.
    expect(chapters.every((c) => !('when' in c))).toBe(true);
  });

  it('climbs a rung of the ladder at every stop', () => {
    for (const checkpoint of CHECKPOINTS) {
      expect(LADDER.some((arc) => arc.level === checkpoint.arc)).toBe(true);
    }
  });

  it('keeps road labels short enough to draw', () => {
    for (const checkpoint of CHECKPOINTS) {
      expect(checkpoint.label.length, checkpoint.id).toBeLessThanOrEqual(14);
      expect(checkpoint.maxi.length, checkpoint.id).toBeGreaterThan(20);
    }
  });

  it('gives the horizon years no promises, only direction', () => {
    expect(CHECKPOINTS.filter(isYear).every((y) => y.state === 'direction')).toBe(true);
  });

  it('has a unique id per stop', () => {
    const ids = CHECKPOINTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
