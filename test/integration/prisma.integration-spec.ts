import { ConfigService } from '@nestjs/config';
import configuration from '../../src/config/configuration';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PrismaService (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const configService = new ConfigService(configuration());
    prisma = new PrismaService(configService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  afterEach(async () => {
    await prisma.workoutSet.deleteMany();
    await prisma.workoutEntry.deleteMany();
  });

  it('persists a WorkoutEntry with a WorkoutSet and reads it back', async () => {
    const entry = await prisma.workoutEntry.create({
      data: {
        userId: 'user-1',
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
        date: new Date('2026-09-01'),
        sets: {
          create: [
            {
              setIndex: 0,
              reps: 5,
              weight: '100',
              unit: 'kg',
              weightKg: '100',
            },
          ],
        },
      },
      include: { sets: true },
    });

    expect(entry.id).toBeDefined();
    expect(entry.sets).toHaveLength(1);
    expect(entry.sets[0].reps).toBe(5);

    const found = await prisma.workoutEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { sets: true },
    });

    expect(found.sets).toHaveLength(1);
    expect(Number(found.sets[0].weightKg)).toBe(100);
    expect(found.date.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('rejects a duplicate set_index within the same entry via UNIQUE(workout_entry_id, set_index)', async () => {
    const entry = await prisma.workoutEntry.create({
      data: {
        userId: 'user-1',
        exerciseName: 'Squat',
        exerciseNameNormalized: 'squat',
        date: new Date('2026-09-02'),
      },
    });

    await prisma.workoutSet.create({
      data: {
        workoutEntryId: entry.id,
        setIndex: 0,
        reps: 5,
        weight: '80',
        unit: 'kg',
        weightKg: '80',
      },
    });

    await expect(
      prisma.workoutSet.create({
        data: {
          workoutEntryId: entry.id,
          setIndex: 0,
          reps: 3,
          weight: '90',
          unit: 'kg',
          weightKg: '90',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a negative reps value via CHECK (reps >= 1)', async () => {
    const entry = await prisma.workoutEntry.create({
      data: {
        userId: 'user-1',
        exerciseName: 'Deadlift',
        exerciseNameNormalized: 'deadlift',
        date: new Date('2026-09-03'),
      },
    });

    await expect(
      prisma.workoutSet.create({
        data: {
          workoutEntryId: entry.id,
          setIndex: 0,
          reps: 0,
          weight: '100',
          unit: 'kg',
          weightKg: '100',
        },
      }),
    ).rejects.toThrow();
  });
});
