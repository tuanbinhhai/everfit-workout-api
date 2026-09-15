import { formatCalendarDate, parseCalendarDate } from './calendar-date';

describe('parseCalendarDate / formatCalendarDate', () => {
  it('round-trips a plain calendar date', () => {
    expect(formatCalendarDate(parseCalendarDate('2026-09-15'))).toBe(
      '2026-09-15',
    );
  });

  it('parses to UTC midnight regardless of host timezone', () => {
    const date = parseCalendarDate('2026-01-01');
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(1);
    expect(date.getUTCHours()).toBe(0);
  });

  it('pads single-digit month and day when formatting', () => {
    expect(formatCalendarDate(parseCalendarDate('2026-03-05'))).toBe(
      '2026-03-05',
    );
  });
});
