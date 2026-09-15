import { normalizeExerciseName } from './normalize-exercise-name';

describe('normalizeExerciseName', () => {
  it('lowercases the input', () => {
    expect(normalizeExerciseName('Bench Press')).toBe('bench press');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeExerciseName('  Squat  ')).toBe('squat');
  });

  it('collapses repeated internal whitespace to a single space', () => {
    expect(normalizeExerciseName('Bench   Press')).toBe('bench press');
  });

  it('produces the same result for differently-cased and spaced input', () => {
    expect(normalizeExerciseName('  BENCH   PRESS ')).toBe(
      normalizeExerciseName('bench press'),
    );
  });
});
