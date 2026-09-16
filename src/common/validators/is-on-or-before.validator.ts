import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

// Only compares when both this property and the referenced property are
// present — shape/format of each is IsCalendarDate's job, not this one.
export function IsOnOrBefore(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isOnOrBefore',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: {
        message: `${propertyName} must not be after ${property}`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];

          if (typeof value !== 'string' || typeof relatedValue !== 'string') {
            return true;
          }

          return value <= relatedValue;
        },
      },
    });
  };
}
