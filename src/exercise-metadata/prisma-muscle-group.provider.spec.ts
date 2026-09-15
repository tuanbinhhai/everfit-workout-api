import { PrismaMuscleGroupProvider } from './prisma-muscle-group.provider';

describe('PrismaMuscleGroupProvider', () => {
  const findUnique = jest.fn();
  const prisma = {
    exerciseMuscleGroup: { findUnique },
  };
  const provider = new PrismaMuscleGroupProvider(prisma as any);

  beforeEach(() => {
    findUnique.mockReset();
  });

  it('resolves a known exercise to its muscle group', async () => {
    findUnique.mockResolvedValue({
      exerciseNameNormalized: 'bench press',
      muscleGroup: 'chest',
    });

    const result = await provider.getMuscleGroup('Bench Press');

    expect(result).toBe('chest');
  });

  it('returns null for an unknown exercise rather than throwing', async () => {
    findUnique.mockResolvedValue(null);

    const result = await provider.getMuscleGroup('Nonexistent Exercise');

    expect(result).toBeNull();
  });

  it('normalizes case and surrounding whitespace before querying', async () => {
    findUnique.mockResolvedValue({ muscleGroup: 'chest' });

    await provider.getMuscleGroup('  BENCH PRESS  ');

    expect(findUnique).toHaveBeenCalledWith({
      where: { exerciseNameNormalized: 'bench press' },
    });
  });

  it('collapses repeated internal whitespace before querying', async () => {
    findUnique.mockResolvedValue(null);

    await provider.getMuscleGroup('Bench   Press');

    expect(findUnique).toHaveBeenCalledWith({
      where: { exerciseNameNormalized: 'bench press' },
    });
  });

  it('delegates to the injected persistence dependency exactly once per call', async () => {
    findUnique.mockResolvedValue(null);

    await provider.getMuscleGroup('Squat');

    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
