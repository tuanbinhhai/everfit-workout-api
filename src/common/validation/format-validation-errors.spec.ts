import { ValidationError } from 'class-validator';
import { formatValidationErrors } from './format-validation-errors';

function error(
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError {
  return { property, constraints, children, target: {}, value: undefined };
}

describe('formatValidationErrors', () => {
  it('flattens a single top-level constraint violation', () => {
    const errors = [
      error('userId', { isNotEmpty: 'userId should not be empty' }),
    ];

    expect(formatValidationErrors(errors)).toEqual([
      { field: 'userId', issue: 'userId should not be empty' },
    ]);
  });

  it('emits one entry per constraint when a property fails multiple rules', () => {
    const errors = [
      error('reps', {
        isInt: 'reps must be an integer number',
        min: 'reps must not be less than 1',
      }),
    ];

    expect(formatValidationErrors(errors)).toEqual([
      { field: 'reps', issue: 'reps must be an integer number' },
      { field: 'reps', issue: 'reps must not be less than 1' },
    ]);
  });

  it('builds a dotted path through nested array validation errors', () => {
    // Mirrors the real class-validator shape for entries[0].sets[1].reps
    const errors = [
      error('entries', undefined, [
        error('0', undefined, [
          error('sets', undefined, [
            error('1', undefined, [
              error('reps', { min: 'reps must not be less than 1' }),
            ]),
          ]),
        ]),
      ]),
    ];

    expect(formatValidationErrors(errors)).toEqual([
      { field: 'entries.0.sets.1.reps', issue: 'reps must not be less than 1' },
    ]);
  });

  it('returns an empty array for no errors', () => {
    expect(formatValidationErrors([])).toEqual([]);
  });
});
