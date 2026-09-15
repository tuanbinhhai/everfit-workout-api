import { isCalendarDate } from './is-calendar-date.validator';

describe('isCalendarDate', () => {
  it('accepts a valid calendar date', () => {
    expect(isCalendarDate('2026-09-15')).toBe(true);
  });

  it('accepts a valid leap-day date', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects a non-leap-year Feb 29', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });

  it('rejects an impossible day-of-month', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
  });

  it('rejects an impossible month', () => {
    expect(isCalendarDate('2026-13-01')).toBe(false);
  });

  it('rejects an ISO datetime instead of a plain date', () => {
    expect(isCalendarDate('2026-09-15T10:00:00Z')).toBe(false);
  });

  it('rejects a malformed date string', () => {
    expect(isCalendarDate('15-09-2026')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isCalendarDate(null)).toBe(false);
    expect(isCalendarDate(undefined)).toBe(false);
    expect(isCalendarDate(20260915)).toBe(false);
  });
});
