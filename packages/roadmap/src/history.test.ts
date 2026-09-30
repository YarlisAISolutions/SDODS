import { describe, expect, it } from 'vitest';
import { ERAS, HISTORY, HISTORY_FROM, yearsOfEra } from './history';
import { HORIZON, CURRENT_YEAR } from './compat';
import { LADDER } from './ladder';
import { TODAY_MONTH } from './calendar';

describe('the road behind the ladder', () => {
  it('runs contiguous years and stops where the ladder starts', () => {
    const years = HISTORY.map((y) => y.year);
    expect(years).toEqual([2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(HISTORY_FROM).toBe(2015);
    expect(Math.max(...years)).toBe(Math.min(...HORIZON.map((h) => h.year)) - 1);
  });

  it('never collides with a year the ladder already renders', () => {
    const ladderYears = new Set(HORIZON.map((h) => h.year));
    for (const year of HISTORY) {
      expect(ladderYears.has(year.year), String(year.year)).toBe(false);
    }
  });

  it('files every year under an era that covers it', () => {
    for (const year of HISTORY) {
      const era = ERAS.find((e) => e.order === year.era);
      expect(era, String(year.year)).toBeDefined();
      expect(year.year).toBeGreaterThanOrEqual(era!.from);
      expect(year.year).toBeLessThanOrEqual(era!.to);
    }
  });

  it('covers the whole road with three eras that do not overlap', () => {
    expect(ERAS.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(ERAS.flatMap((e) => yearsOfEra(e).map((y) => y.year))).toEqual(
      HISTORY.map((y) => y.year),
    );
    for (const [i, era] of ERAS.slice(1).entries()) {
      expect(era.from).toBe(ERAS[i]!.to + 1);
    }
  });

  it('promises nothing in the past, because nothing was released then', () => {
    for (const year of HISTORY) {
      // `shift` is industry fact, `carried` is a decision in today's code. Neither is a ship date.
      expect(year.shift.length, String(year.year)).toBeGreaterThan(60);
      expect(year.carried.length, String(year.year)).toBeGreaterThan(40);
      expect(year.tech.length, String(year.year)).toBeGreaterThanOrEqual(3);
      expect(year).not.toHaveProperty('ships');
      expect(year).not.toHaveProperty('proof');
    }
  });

  it('keeps road labels short enough to draw', () => {
    for (const year of HISTORY) {
      expect(year.label.length, String(year.year)).toBeLessThanOrEqual(14);
    }
  });

  it('gives every rung of the ladder a line in the tutor’s voice', () => {
    for (const arc of LADDER) {
      expect(arc.maxi.length, arc.name).toBeGreaterThan(20);
    }
  });

  it('flags today on the calendar year the site was built in, not the rung it climbs', () => {
    expect(CURRENT_YEAR).toBe(Number(TODAY_MONTH.slice(0, 4)));
  });
});
