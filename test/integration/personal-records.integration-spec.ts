import { ConfigService } from '@nestjs/config';
import configuration from '../../src/config/configuration';
import { normalizeExerciseName } from '../../src/common/normalize-exercise-name';
import { PersonalRecordsRepository } from '../../src/workouts/personal-records.repository';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PersonalRecordsRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PersonalRecordsRepository;

  beforeAll(async () => {
    const configService = new ConfigService(configuration());
    prisma = new PrismaService(configService);
    await prisma.onModuleInit();
    repository = new PersonalRecordsRepository(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  afterEach(async () => {
    await prisma.workoutSet.deleteMany();
    await prisma.workoutEntry.deleteMany();
  });

  interface SeedSetOptions {
    userId?: string;
    exerciseName?: string;
    date: string;
    reps: number;
    weight: string;
    unit: string;
    weightKg: string;
  }

  async function seedSet(opts: SeedSetOptions): Promise<{ id: bigint }> {
    const userId = opts.userId ?? 'user-1';
    const exerciseName = opts.exerciseName ?? 'Bench Press';
    const entry = await prisma.workoutEntry.create({
      data: {
        userId,
        exerciseName,
        exerciseNameNormalized: normalizeExerciseName(exerciseName),
        date: new Date(opts.date),
        sets: {
          create: [
            {
              setIndex: 0,
              reps: opts.reps,
              weight: opts.weight,
              unit: opts.unit,
              weightKg: opts.weightKg,
            },
          ],
        },
      },
      include: { sets: true },
    });
    return { id: entry.sets[0].id };
  }

  function candidates(userId = 'user-1', exerciseName = 'Bench Press') {
    return repository.findCandidates(
      userId,
      normalizeExerciseName(exerciseName),
    );
  }

  it('picks the highest canonical weight as the heaviest set', async () => {
    await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
    await seedSet({
      date: '2026-09-02',
      reps: 5,
      weight: '150',
      unit: 'kg',
      weightKg: '150',
    });
    await seedSet({
      date: '2026-09-03',
      reps: 5,
      weight: '120',
      unit: 'kg',
      weightKg: '120',
    });

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(weightWinner).toBeDefined();
    expect(Number(weightWinner?.weightKg)).toBe(150);
  });

  it('picks the highest reps*weightKg as the volume winner, which can be a lighter/high-rep set', async () => {
    // Heavy/low-rep set: volume = 200
    await seedSet({
      date: '2026-09-01',
      reps: 1,
      weight: '200',
      unit: 'kg',
      weightKg: '200',
    });
    // Lighter/high-rep set: volume = 40*30 = 1200 (beats the heavy set's volume)
    await seedSet({
      date: '2026-09-02',
      reps: 30,
      weight: '40',
      unit: 'kg',
      weightKg: '40',
    });

    const rows = await candidates();
    const volumeWinner = rows.find((r) => r.rnVolume === 1);

    expect(volumeWinner).toBeDefined();
    expect(Number(volumeWinner?.weightKg)).toBe(40);
    expect(volumeWinner?.reps).toBe(30);
  });

  it('produces three distinct winners for weight, volume, and 1RM from a deliberately non-trivial dataset', async () => {
    // Set A: heaviest (300kg x 1) -> weight=300, volume=300, 1RM=310
    await seedSet({
      date: '2026-09-01',
      reps: 1,
      weight: '300',
      unit: 'kg',
      weightKg: '300',
    });
    // Set B: highest volume (60kg x 30) -> weight=60, volume=1800, 1RM=120
    await seedSet({
      date: '2026-09-02',
      reps: 30,
      weight: '60',
      unit: 'kg',
      weightKg: '60',
    });
    // Set C: best 1RM (280kg x 4) -> weight=280, volume=1120, 1RM=317.33
    await seedSet({
      date: '2026-09-03',
      reps: 4,
      weight: '280',
      unit: 'kg',
      weightKg: '280',
    });

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);
    const volumeWinner = rows.find((r) => r.rnVolume === 1);
    const oneRmWinner = rows.find((r) => r.rn1Rm === 1);

    expect(Number(weightWinner?.weightKg)).toBe(300);
    expect(Number(volumeWinner?.weightKg)).toBe(60);
    expect(Number(oneRmWinner?.weightKg)).toBe(280);

    // All three are genuinely different sets, not the same "best overall" set.
    expect(weightWinner?.id).not.toBe(volumeWinner?.id);
    expect(volumeWinner?.id).not.toBe(oneRmWinner?.id);
    expect(weightWinner?.id).not.toBe(oneRmWinner?.id);
  });

  it('ranks correctly across mixed kg/lb history using canonical weightKg', async () => {
    // 220lb -> ~99.79kg
    await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '220',
      unit: 'lb',
      weightKg: '99.7903',
    });
    // 90kg — less than 99.7903kg, should lose despite being a "rounder" number
    await seedSet({
      date: '2026-09-02',
      reps: 5,
      weight: '90',
      unit: 'kg',
      weightKg: '90',
    });

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(weightWinner?.reps).toBe(5);
    expect(Number(weightWinner?.weightKg)).toBeCloseTo(99.7903, 4);
  });

  it('breaks a metric tie by earliest achievement date', async () => {
    await seedSet({
      date: '2026-09-10',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
    const earlier = await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(weightWinner?.id).toBe(earlier.id.toString());
    expect(weightWinner?.date).toBe('2026-09-01');
  });

  it('breaks a same-date metric tie by the lower set id', async () => {
    const first = await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
    await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(weightWinner?.id).toBe(first.id.toString());
  });

  it('does not let another user’s heavier set affect this user’s PRs', async () => {
    await seedSet({
      userId: 'user-1',
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
    await seedSet({
      userId: 'user-2',
      date: '2026-09-01',
      reps: 5,
      weight: '999',
      unit: 'kg',
      weightKg: '999',
    });

    const rows = await candidates('user-1');
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(Number(weightWinner?.weightKg)).toBe(100);
  });

  it('does not let another exercise’s heavier set affect this exercise’s PRs', async () => {
    await seedSet({
      exerciseName: 'Bench Press',
      date: '2026-09-01',
      reps: 5,
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
    await seedSet({
      exerciseName: 'Deadlift',
      date: '2026-09-01',
      reps: 5,
      weight: '999',
      unit: 'kg',
      weightKg: '999',
    });

    const rows = await candidates('user-1', 'Bench Press');
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(Number(weightWinner?.weightKg)).toBe(100);
  });

  it('returns no candidates when the user/exercise has no data', async () => {
    const rows = await candidates('user-with-no-history', 'Bench Press');
    expect(rows).toEqual([]);
  });

  it('uses full NUMERIC(10,4) precision for ranking, not display-rounded values', async () => {
    // Both would round to "100.00" at 2dp, but differ at the 4th decimal —
    // the larger one must deterministically win, not tie or pick arbitrarily.
    const smaller = await seedSet({
      date: '2026-09-01',
      reps: 5,
      weight: '100.0012',
      unit: 'kg',
      weightKg: '100.0012',
    });
    const larger = await seedSet({
      date: '2026-09-02',
      reps: 5,
      weight: '100.0049',
      unit: 'kg',
      weightKg: '100.0049',
    });
    void smaller;

    const rows = await candidates();
    const weightWinner = rows.find((r) => r.rnWeight === 1);

    expect(weightWinner?.id).toBe(larger.id.toString());
    expect(Number(weightWinner?.weightKg)).toBeCloseTo(100.0049, 4);
  });
});
