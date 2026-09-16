import { PrismaService } from '../prisma/prisma.service';
import { PrismaMuscleGroupProvider } from './prisma-muscle-group.provider';

describe('PrismaMuscleGroupProvider', () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const prisma = {
    exerciseMuscleGroup: { findUnique, findMany },
  } as unknown as PrismaService;
  const provider = new PrismaMuscleGroupProvider(prisma);

  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
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

  describe('listExerciseNames', () => {
    it('returns the normalized exercise names mapped to a muscle group', async () => {
      findMany.mockResolvedValue([
        { exerciseNameNormalized: 'bench press' },
        { exerciseNameNormalized: 'incline bench press' },
      ]);

      const result = await provider.listExerciseNames('chest');

      expect(result).toEqual(['bench press', 'incline bench press']);
      expect(findMany).toHaveBeenCalledWith({
        where: { muscleGroup: 'chest' },
        select: { exerciseNameNormalized: true },
      });
    });

    it('normalizes the muscle group before querying', async () => {
      findMany.mockResolvedValue([]);

      await provider.listExerciseNames('  Chest  ');

      expect(findMany).toHaveBeenCalledWith({
        where: { muscleGroup: 'chest' },
        select: { exerciseNameNormalized: true },
      });
    });

    it('returns an empty array for an unmapped muscle group rather than throwing', async () => {
      findMany.mockResolvedValue([]);

      const result = await provider.listExerciseNames('nonexistent');

      expect(result).toEqual([]);
    });
  });
});
