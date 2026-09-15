import { registerDecorator, ValidationOptions } from 'class-validator';

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !DATE_SHAPE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Date rolls over invalid components (e.g. month 13, Feb 30) instead of
  // throwing, so a round-trip mismatch is how an impossible date is caught.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function IsCalendarDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid calendar date in YYYY-MM-DD format`,
        ...validationOptions,
      },
      validator: {
        validate: isCalendarDate,
      },
    });
  };
}
