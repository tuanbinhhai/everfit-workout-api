import { calculateEpley1Rm, calculateVolume } from './pr-calculations';

describe('calculateEpley1Rm', () => {
  it('computes a known input correctly', () => {
    // 100kg x 5 reps -> 100 * (1 + 5/30) = 116.666...
    expect(calculateEpley1Rm(100, 5)).toBeCloseTo(116.6666666667, 9);
  });

  it('computes a representative decimal input correctly', () => {
    // 82.5kg x 8 reps -> 104.5 exactly
    expect(calculateEpley1Rm(82.5, 8)).toBeCloseTo(104.5, 9);
  });

  it('does not truncate precision beyond 2 decimal places on the input', () => {
    // A weightKg with 4 decimal places (matching NUMERIC(10,4) storage)
    // must be honored in full, not rounded to 2dp before multiplying.
    expect(calculateEpley1Rm(100.1234, 5)).toBeCloseTo(116.8106333333, 9);
  });

  it('is the identity-like formula for 1 rep (1RM of a 1-rep set is the weight itself)', () => {
    expect(calculateEpley1Rm(100, 1)).toBeCloseTo(100 * (1 + 1 / 30), 9);
  });

  it('increases monotonically with reps for a fixed weight', () => {
    const low = calculateEpley1Rm(100, 3);
    const high = calculateEpley1Rm(100, 10);
    expect(high).toBeGreaterThan(low);
  });
});

describe('calculateVolume', () => {
  it('computes a known input correctly', () => {
    expect(calculateVolume(100, 5)).toBe(500);
  });

  it('computes a representative decimal input correctly', () => {
    expect(calculateVolume(82.5, 8)).toBe(660);
  });

  it('does not truncate precision beyond 2 decimal places on the input', () => {
    expect(calculateVolume(33.3333, 7)).toBeCloseTo(233.3331, 9);
  });
});
