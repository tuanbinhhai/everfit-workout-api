import { ConfigService } from '@nestjs/config';
import configuration from '../../src/config/configuration';
import { PrismaMuscleGroupProvider } from '../../src/exercise-metadata/prisma-muscle-group.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  WorkoutEntryInput,
  WorkoutsRepository,
} from '../../src/workouts/workouts.repository';

describe('WorkoutsRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: WorkoutsRepository;

  beforeAll(async () => {
    const configService = new ConfigService(configuration());
    prisma = new PrismaService(configService);
    await prisma.onModuleInit();
    const muscleGroupProvider = new PrismaMuscleGroupProvider(prisma);
    repository = new WorkoutsRepository(prisma, muscleGroupProvider);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  afterEach(async () => {
    await prisma.workoutSet.deleteMany();
    await prisma.workoutEntry.deleteMany();
  });

  function entry(
    overrides: Partial<WorkoutEntryInput> = {},
  ): WorkoutEntryInput {
    return {
      userId: 'user-1',
      exerciseName: 'Bench Press',
      exerciseNameNormalized: 'bench press',
      date: new Date('2026-09-01'),
      sets: [
        { setIndex: 0, reps: 5, weight: '100', unit: 'kg', weightKg: '100' },
      ],
      ...overrides,
    };
  }

  it('persists one workout entry with its sets', async () => {
    const [created] = await repository.createMany([entry()]);

    expect(created.userId).toBe('user-1');
    expect(created.exerciseName).toBe('Bench Press');
    expect(created.sets).toHaveLength(1);
    expect(created.sets[0].reps).toBe(5);

    const row = await prisma.workoutEntry.findUniqueOrThrow({
      where: { id: created.id },
      include: { sets: true },
    });
    expect(row.sets).toHaveLength(1);
  });

  it('persists multiple workout entries in one call', async () => {
    const created = await repository.createMany([
      entry({
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
      }),
      entry({ exerciseName: 'Squat', exerciseNameNormalized: 'squat' }),
    ]);

    expect(created).toHaveLength(2);
    const count = await prisma.workoutEntry.count();
    expect(count).toBe(2);
  });

  it('stores the original weight/unit alongside the normalized weightKg', async () => {
    const [created] = await repository.createMany([
      entry({
        sets: [
          {
            setIndex: 0,
            reps: 5,
            weight: '220',
            unit: 'lb',
            weightKg: '99.7903214',
          },
        ],
      }),
    ]);

    const set = created.sets[0];
    expect(set.unit).toBe('lb');
    expect(Number(set.weight)).toBe(220);
    // NUMERIC(10,4) rounds the stored value to 4 decimal places.
    expect(Number(set.weightKg)).toBeCloseTo(99.7903, 4);
  });

  it('preserves set order via setIndex regardless of insertion batching', async () => {
    const [created] = await repository.createMany([
      entry({
        sets: [
          { setIndex: 0, reps: 5, weight: '100', unit: 'kg', weightKg: '100' },
          { setIndex: 1, reps: 5, weight: '105', unit: 'kg', weightKg: '105' },
          { setIndex: 2, reps: 3, weight: '110', unit: 'kg', weightKg: '110' },
        ],
      }),
    ]);

    expect(created.sets.map((s) => s.setIndex)).toEqual([0, 1, 2]);
    expect(created.sets.map((s) => Number(s.weight))).toEqual([100, 105, 110]);
  });

  it('attributes each entry only its own sets when creating multiple entries at once', async () => {
    const created = await repository.createMany([
      entry({
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
        sets: [
          { setIndex: 0, reps: 5, weight: '100', unit: 'kg', weightKg: '100' },
        ],
      }),
      entry({
        exerciseName: 'Squat',
        exerciseNameNormalized: 'squat',
        sets: [
          { setIndex: 0, reps: 5, weight: '150', unit: 'kg', weightKg: '150' },
        ],
      }),
    ]);

    const benchEntry = created.find((e) => e.exerciseName === 'Bench Press');
    const squatEntry = created.find((e) => e.exerciseName === 'Squat');
    expect(Number(benchEntry?.sets[0].weight)).toBe(100);
    expect(Number(squatEntry?.sets[0].weight)).toBe(150);
  });

  it('rolls back the entire transaction if any set violates a DB constraint', async () => {
    const beforeEntries = await prisma.workoutEntry.count();
    const beforeSets = await prisma.workoutSet.count();

    await expect(
      repository.createMany([
        entry({
          sets: [
            {
              setIndex: 0,
              reps: 5,
              weight: '100',
              unit: 'kg',
              weightKg: '100',
            },
            // duplicate setIndex -> violates UNIQUE(workout_entry_id, set_index)
            { setIndex: 0, reps: 3, weight: '90', unit: 'kg', weightKg: '90' },
          ],
        }),
      ]),
    ).rejects.toThrow();

    // Nothing persisted, including the entry itself and its first (valid) set.
    expect(await prisma.workoutEntry.count()).toBe(beforeEntries);
    expect(await prisma.workoutSet.count()).toBe(beforeSets);
  });

  it('still enforces CHECK(reps >= 1) even bypassing the service/DTO layer', async () => {
    await expect(
      repository.createMany([
        entry({
          sets: [
            {
              setIndex: 0,
              reps: 0,
              weight: '100',
              unit: 'kg',
              weightKg: '100',
            },
          ],
        }),
      ]),
    ).rejects.toThrow();

    expect(await prisma.workoutEntry.count()).toBe(0);
  });
});
