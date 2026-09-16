import { ConfigService } from '@nestjs/config';
import configuration from '../../src/config/configuration';
import { PrismaMuscleGroupProvider } from '../../src/exercise-metadata/prisma-muscle-group.provider';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  WorkoutEntryInput,
  WorkoutHistoryFilter,
  WorkoutsRepository,
} from '../../src/workouts/workouts.repository';

describe('WorkoutsRepository.findHistory (integration)', () => {
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

  function filter(
    overrides: Partial<WorkoutHistoryFilter> = {},
  ): WorkoutHistoryFilter {
    return { userId: 'user-1', limit: 20, ...overrides };
  }

  it('only returns entries belonging to the requested user', async () => {
    await repository.createMany([
      entry({ userId: 'user-1' }),
      entry({ userId: 'user-2' }),
    ]);

    const page = await repository.findHistory(filter({ userId: 'user-1' }));

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].userId).toBe('user-1');
  });

  it('orders results by date DESC, id DESC', async () => {
    const created = await repository.createMany([
      entry({ date: new Date('2026-09-01') }),
      entry({ date: new Date('2026-09-03') }),
      entry({ date: new Date('2026-09-02') }),
    ]);
    void created;

    const page = await repository.findHistory(filter());

    expect(page.entries.map((e) => e.date.toISOString().slice(0, 10))).toEqual([
      '2026-09-03',
      '2026-09-02',
      '2026-09-01',
    ]);
  });

  it('breaks ties on the same date by id DESC', async () => {
    const created = await repository.createMany([
      entry({ exerciseName: 'A', exerciseNameNormalized: 'a' }),
      entry({ exerciseName: 'B', exerciseNameNormalized: 'b' }),
      entry({ exerciseName: 'C', exerciseNameNormalized: 'c' }),
    ]);

    const page = await repository.findHistory(filter());

    const ids = page.entries.map((e) => e.id);
    const sortedDesc = [...created]
      .map((e) => e.id)
      .sort((a, b) => (a > b ? -1 : 1));
    expect(ids).toEqual(sortedDesc);
  });

  it('applies an inclusive `from` boundary', async () => {
    await repository.createMany([
      entry({ date: new Date('2026-09-01') }),
      entry({ date: new Date('2026-09-02') }),
    ]);

    const page = await repository.findHistory(
      filter({ from: new Date('2026-09-02') }),
    );

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].date.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('applies an inclusive `to` boundary', async () => {
    await repository.createMany([
      entry({ date: new Date('2026-09-01') }),
      entry({ date: new Date('2026-09-02') }),
    ]);

    const page = await repository.findHistory(
      filter({ to: new Date('2026-09-01') }),
    );

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].date.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('includes entries exactly on both boundary dates', async () => {
    await repository.createMany([
      entry({ date: new Date('2026-09-01') }),
      entry({ date: new Date('2026-09-15') }),
      entry({ date: new Date('2026-09-30') }),
    ]);

    const page = await repository.findHistory(
      filter({ from: new Date('2026-09-01'), to: new Date('2026-09-30') }),
    );

    expect(page.entries).toHaveLength(3);
  });

  it('matches a case-insensitive partial exercise name substring', async () => {
    await repository.createMany([
      entry({
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
      }),
      entry({
        exerciseName: 'Incline Bench Press',
        exerciseNameNormalized: 'incline bench press',
      }),
      entry({ exerciseName: 'Squat', exerciseNameNormalized: 'squat' }),
    ]);

    const page = await repository.findHistory(
      filter({ exerciseNameSubstring: 'bench' }),
    );

    expect(page.entries).toHaveLength(2);
    expect(page.entries.map((e) => e.exerciseName).sort()).toEqual([
      'Bench Press',
      'Incline Bench Press',
    ]);
  });

  it('filters by muscle group using the configurable mapping', async () => {
    await repository.createMany([
      entry({
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
      }),
      entry({ exerciseName: 'Squat', exerciseNameNormalized: 'squat' }),
    ]);

    const page = await repository.findHistory(filter({ muscleGroup: 'chest' }));

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].exerciseName).toBe('Bench Press');
  });

  it('returns no results for a muscle group with no mapped exercises, without error', async () => {
    await repository.createMany([entry()]);

    const page = await repository.findHistory(
      filter({ muscleGroup: 'nonexistent-muscle-group' }),
    );

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('composes exercise name, date range, and muscle group filters together', async () => {
    await repository.createMany([
      entry({
        exerciseName: 'Bench Press',
        exerciseNameNormalized: 'bench press',
        date: new Date('2026-09-15'),
      }),
      entry({
        exerciseName: 'Incline Bench Press',
        exerciseNameNormalized: 'incline bench press',
        date: new Date('2026-08-01'), // outside the date range
      }),
      entry({
        exerciseName: 'Squat',
        exerciseNameNormalized: 'squat',
        date: new Date('2026-09-15'), // wrong muscle group
      }),
    ]);

    const page = await repository.findHistory(
      filter({
        exerciseNameSubstring: 'bench',
        muscleGroup: 'chest',
        from: new Date('2026-09-01'),
        to: new Date('2026-09-30'),
      }),
    );

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].exerciseName).toBe('Bench Press');
  });

  it('paginates across multiple pages with no skipped or duplicated rows', async () => {
    const inputs = Array.from({ length: 25 }, (_, i) =>
      entry({
        exerciseName: `Exercise ${i}`,
        exerciseNameNormalized: `exercise ${i}`,
        date: new Date(Date.UTC(2026, 8, 1 + i)),
      }),
    );
    await repository.createMany(inputs);

    const seen: string[] = [];
    let cursor: { date: Date; id: bigint } | undefined;
    let pages = 0;

    for (;;) {
      const page = await repository.findHistory(filter({ limit: 10, cursor }));
      seen.push(...page.entries.map((e) => e.id.toString()));
      pages += 1;

      if (!page.hasMore) break;
      const last = page.entries[page.entries.length - 1];
      cursor = { date: last.date, id: last.id };

      if (pages > 10) throw new Error('pagination did not terminate');
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25); // no duplicates
    expect(pages).toBe(3); // 10 + 10 + 5
  });

  it('correctly paginates across a cursor boundary where multiple entries share a date', async () => {
    await repository.createMany([
      entry({
        exerciseName: 'A',
        exerciseNameNormalized: 'a',
        date: new Date('2026-09-01'),
      }),
      entry({
        exerciseName: 'B',
        exerciseNameNormalized: 'b',
        date: new Date('2026-09-01'),
      }),
      entry({
        exerciseName: 'C',
        exerciseNameNormalized: 'c',
        date: new Date('2026-09-01'),
      }),
      entry({
        exerciseName: 'D',
        exerciseNameNormalized: 'd',
        date: new Date('2026-09-01'),
      }),
    ]);

    const firstPage = await repository.findHistory(filter({ limit: 2 }));
    expect(firstPage.entries).toHaveLength(2);
    expect(firstPage.hasMore).toBe(true);

    const last = firstPage.entries[firstPage.entries.length - 1];
    const secondPage = await repository.findHistory(
      filter({ limit: 2, cursor: { date: last.date, id: last.id } }),
    );

    expect(secondPage.entries).toHaveLength(2);
    expect(secondPage.hasMore).toBe(false);

    const firstIds = firstPage.entries.map((e) => e.id.toString());
    const secondIds = secondPage.entries.map((e) => e.id.toString());
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4); // no overlap
  });

  it('returns an empty page (not an error) when nothing matches', async () => {
    const page = await repository.findHistory(
      filter({ exerciseNameSubstring: 'nonexistent-exercise' }),
    );

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('leaves the original stored weight/unit/weightKg unchanged regardless of read filters', async () => {
    await repository.createMany([
      entry({
        sets: [
          {
            setIndex: 0,
            reps: 5,
            weight: '220',
            unit: 'lb',
            weightKg: '99.7903',
          },
        ],
      }),
    ]);

    const page = await repository.findHistory(filter());
    const set = page.entries[0].sets[0];

    expect(String(set.weight)).toBe('220');
    expect(set.unit).toBe('lb');
    expect(String(set.weightKg)).toBe('99.7903');

    // Confirm the underlying row is unaffected too, not just the returned shape.
    const row = await prisma.workoutSet.findUniqueOrThrow({
      where: { id: set.id },
    });
    expect(String(row.weight)).toBe('220');
    expect(row.unit).toBe('lb');
    expect(String(row.weightKg)).toBe('99.7903');
  });
});
