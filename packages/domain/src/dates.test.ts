import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonthsAnchored,
  dateInTimeZone,
  daysBetween,
  isLeapYear,
  parseDate,
  zonedTimeToUtc,
} from './dates.js';

describe('dates', () => {
  it('rejects dates that are not on the calendar', () => {
    expect(() => parseDate('2026-02-30')).toThrow(/calendar/);
    expect(() => parseDate('2026-13-01')).toThrow(/calendar/);
    expect(() => parseDate('26-1-1')).toThrow(/YYYY-MM-DD/);
    expect(parseDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('knows leap years, including the century rules', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('adds and subtracts days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
    expect(daysBetween('2026-02-01', '2026-01-01')).toBe(-31);
  });

  it('keeps the anchor day when adding months', () => {
    expect(addMonthsAnchored('2025-01-31', 1, 31)).toBe('2025-02-28');
    expect(addMonthsAnchored('2025-02-28', 1, 31)).toBe('2025-03-31');
    expect(addMonthsAnchored('2024-01-31', 1, 31)).toBe('2024-02-29');
    expect(addMonthsAnchored('2025-11-30', 2, 30)).toBe('2026-01-30');
    expect(addMonthsAnchored('2024-02-29', 12, 29)).toBe('2025-02-28');
  });

  it('turns a wall-clock time in a timezone into a UTC instant, across DST', () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer (DST starts 29 March 2026).
    expect(zonedTimeToUtc('2026-03-01', 9, 0, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-01T08:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-30', 9, 0, 'Europe/Berlin').toISOString()).toBe(
      '2026-03-30T07:00:00.000Z',
    );
    // Toronto is UTC-5 in winter and UTC-4 after 8 March 2026.
    expect(zonedTimeToUtc('2026-03-01', 9, 0, 'America/Toronto').toISOString()).toBe(
      '2026-03-01T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-09', 9, 0, 'America/Toronto').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-06-15', 9, 0, 'UTC').toISOString()).toBe(
      '2026-06-15T09:00:00.000Z',
    );
  });

  it('reports the calendar date of an instant in a timezone', () => {
    const lateEvening = new Date('2026-06-15T23:30:00Z');
    expect(dateInTimeZone(lateEvening, 'UTC')).toBe('2026-06-15');
    expect(dateInTimeZone(lateEvening, 'Europe/Berlin')).toBe('2026-06-16');
    expect(dateInTimeZone(lateEvening, 'America/Toronto')).toBe('2026-06-15');
  });

  it('rejects an unknown timezone', () => {
    expect(() => zonedTimeToUtc('2026-01-01', 9, 0, 'Mars/Olympus')).toThrow(RangeError);
  });
});
