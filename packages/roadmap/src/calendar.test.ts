import { describe, expect, it } from 'vitest';
import { TODAY_MONTH, isOverdue, monthOf, overdue, timing } from './calendar';
import { CHECKPOINTS } from './checkpoints';

const stop = (id: string) => CHECKPOINTS.find((c) => c.id === id)!;

describe('the calendar against the road', () => {
  it('knows which month it is', () => {
    expect(TODAY_MONTH).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });

  it('reads the month in UTC', () => {
    expect(monthOf(new Date('2027-01-31T23:30:00Z'))).toBe('2027-01');
  });

  it('places a month before, on or after today', () => {
    expect(timing(stop('m-2027-02'), '2027-01')).toBe('future');
    expect(timing(stop('m-2027-02'), '2027-02')).toBe('current');
    expect(timing(stop('m-2027-02'), '2027-03')).toBe('past');
  });

  it('places a horizon year by its calendar year', () => {
    expect(timing(stop('y-2028'), '2027-12')).toBe('future');
    expect(timing(stop('y-2028'), '2028-06')).toBe('current');
    expect(timing(stop('y-2028'), '2029-01')).toBe('past');
  });

  it('gives an undated chapter no timing and never calls it overdue', () => {
    expect(timing(stop('ch-foundations'), '2099-01')).toBeUndefined();
    expect(isOverdue(stop('ch-foundations'), '2099-01')).toBe(false);
  });

  it('flags a stop only once its month has ended undelivered', () => {
    expect(isOverdue(stop('m-2027-02'), '2027-02')).toBe(false);
    expect(isOverdue(stop('m-2027-02'), '2027-03')).toBe(true);
  });

  it('never flags a delivered stop, however late the calendar', () => {
    expect(isOverdue(stop('m-2026-10'), '2030-01')).toBe(false);
  });

  it('lists every overdue stop, oldest first', () => {
    expect(overdue('2027-03').map((c) => c.id)).toEqual(['m-2027-01', 'm-2027-02']);
    expect(overdue('2026-09')).toEqual([]);
  });
});
