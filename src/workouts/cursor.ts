import { isCalendarDate } from '../common/validators/is-calendar-date.validator';

export interface WorkoutHistoryCursor {
  date: string;
  id: string;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCursor(cursor: WorkoutHistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): WorkoutHistoryCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidCursorError();
  }

  const { date, id } = parsed as Record<string, unknown>;

  if (typeof date !== 'string' || !isCalendarDate(date)) {
    throw new InvalidCursorError();
  }
  if (typeof id !== 'string' || !/^\d+$/.test(id)) {
    throw new InvalidCursorError();
  }

  return { date, id };
}
