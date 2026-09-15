// A "calendar date" here is a plain YYYY-MM-DD business date with no
// timezone semantics — see docs/CLARIFICATIONS.md #2/#3. Parsed/formatted
// via UTC component accessors so the host machine's local timezone can
// never shift the date by a day.

export function parseCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
