// Captures the REAL SQL (via Prisma's query-event log) that the application's
// own repository methods send to Postgres for each Step 12 benchmark
// scenario, then re-runs that exact SQL+params wrapped in
// EXPLAIN (ANALYZE, BUFFERS) so docs/PERFORMANCE_NOTES.md is built from
// actual query plans against the real repository code path — not a
// hand-reconstructed approximation of what the app "should" be sending.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeExerciseName } from '../src/common/normalize-exercise-name';
import { PrismaMuscleGroupProvider } from '../src/exercise-metadata/prisma-muscle-group.provider';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { PersonalRecordsRepository } from '../src/workouts/personal-records.repository';
import { WorkoutsRepository } from '../src/workouts/workouts.repository';
import { PERF_USER } from './seed-scale-test';

interface CapturedQuery {
  query: string;
  params: string;
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const rawClient = new PrismaClient({
    adapter,
    log: [{ emit: 'event', level: 'query' }],
  });
  // Repositories are typed against PrismaService (the NestJS-wrapped
  // subclass); this script constructs the underlying PrismaClient directly
  // to get access to query-event logging, which PrismaService's constructor
  // doesn't expose. Safe here: the repositories only ever call plain
  // PrismaClient methods, none of which PrismaService overrides.
  const prisma = rawClient as unknown as PrismaService;

  const captured: CapturedQuery[] = [];
  rawClient.$on('query', (event) => {
    captured.push(event);
  });

  const muscleGroupProvider = new PrismaMuscleGroupProvider(prisma);
  const workoutsRepository = new WorkoutsRepository(
    prisma,
    muscleGroupProvider,
  );
  const personalRecordsRepository = new PersonalRecordsRepository(prisma);

  // Prisma's `include: { sets: ... }` relation loading issues TWO separate
  // statements per findHistory() call (one SELECT on workout_entries with
  // the where/orderBy/cursor/take logic under test, then a second SELECT on
  // workout_sets batched by workout_entry_id). An earlier version of this
  // script only explained the LAST captured query, which silently explained
  // the wrong (sets) statement for every findHistory scenario. Explain every
  // query captured during the call instead.
  async function explainCapturedQueries(label: string): Promise<void> {
    if (captured.length === 0) {
      console.log(`\n=== ${label} ===\n(no query captured)`);
      return;
    }
    // Snapshot before iterating: the $on('query', ...) listener also fires
    // for the EXPLAIN statements issued inside this loop (same rawClient),
    // so iterating the live `captured` array would pick up its own EXPLAIN
    // call mid-loop and try to EXPLAIN an "EXPLAIN ..." statement.
    const toExplain = [...captured];
    for (const [i, entry] of toExplain.entries()) {
      const params = JSON.parse(entry.params) as unknown[];
      const rows = await prisma.$queryRawUnsafe<
        Array<{ 'QUERY PLAN': string }>
      >(`EXPLAIN (ANALYZE, BUFFERS) ${entry.query}`, ...params);
      console.log(
        `\n=== ${label} [statement ${i + 1}/${toExplain.length}] ===`,
      );
      console.log(`SQL: ${entry.query}`);
      console.log(`Params: ${entry.params}`);
      console.log('---');
      console.log(rows.map((r) => r['QUERY PLAN']).join('\n'));
    }
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    captured.length = 0;
    const result = await fn();
    await explainCapturedQueries(label);
    return result;
  }

  // --- Baseline stats ---
  await prisma.$executeRawUnsafe(
    'ANALYZE workout_entries, workout_sets, exercise_muscle_groups;',
  );
  const entryCount = await prisma.workoutEntry.count({
    where: { userId: PERF_USER },
  });
  const setCount = await prisma.workoutSet.count({
    where: { entry: { userId: PERF_USER } },
  });
  const muscleGroupCount = await prisma.exerciseMuscleGroup.count();
  console.log('=== Baseline row counts ===');
  console.log(`workout_entries (perf-user): ${entryCount}`);
  console.log(`workout_sets (perf-user): ${setCount}`);
  console.log(`exercise_muscle_groups: ${muscleGroupCount}`);

  // --- 1. History base case ---
  await run('1. History base case (GET /workouts, first page, limit=20)', () =>
    workoutsRepository.findHistory({ userId: PERF_USER, limit: 20 }),
  );

  // --- 2. Deep cursor page ---
  // Benchmark-only: find a cursor ~25,000 rows into this user's history via
  // OFFSET. This is NOT how the app paginates — it is only used here to
  // locate a realistic deep cursor value to feed into the real keyset query.
  const deepRow = await prisma.$queryRaw<Array<{ date: Date; id: bigint }>>`
    SELECT date, id FROM workout_entries
    WHERE user_id = ${PERF_USER}
    ORDER BY date DESC, id DESC
    OFFSET 25000 LIMIT 1;
  `;
  const cursor = deepRow[0];
  await run('2. History deep cursor page (~25,000 rows in, limit=20)', () =>
    workoutsRepository.findHistory({
      userId: PERF_USER,
      limit: 20,
      cursor: cursor ? { date: cursor.date, id: cursor.id } : undefined,
    }),
  );

  // --- 3. Partial exercise search ---
  await run('3. Partial exercise search (exerciseName=bench, limit=20)', () =>
    workoutsRepository.findHistory({
      userId: PERF_USER,
      exerciseNameSubstring: normalizeExerciseName('bench'),
      limit: 20,
    }),
  );

  // --- 4. Combined filter: partial exercise + date range ---
  await run('4. Combined filter (bench + 60-day date range, limit=20)', () =>
    workoutsRepository.findHistory({
      userId: PERF_USER,
      exerciseNameSubstring: normalizeExerciseName('bench'),
      from: new Date(Date.UTC(2026, 7, 15)),
      to: new Date(Date.UTC(2026, 9, 15)),
      limit: 20,
    }),
  );

  // --- 5. Muscle group filter ---
  console.log('\n=== 5a. Muscle group metadata lookup (listExerciseNames) ===');
  const muscleGroupStart = Date.now();
  const chestExerciseNames =
    await muscleGroupProvider.listExerciseNames('chest');
  console.log(
    `listExerciseNames('chest') -> ${JSON.stringify(chestExerciseNames)} in ${Date.now() - muscleGroupStart}ms`,
  );
  await run('5b. History filtered by muscleGroup=chest (limit=20)', () =>
    workoutsRepository.findHistory({
      userId: PERF_USER,
      muscleGroup: 'chest',
      limit: 20,
    }),
  );

  // --- 6. PR all-time (worst-case concentration exercise) ---
  await run(
    '6. Personal records, all-time, worst-case concentration exercise (bench press, ~20,000 entries)',
    () => personalRecordsRepository.findCandidates(PERF_USER, 'bench press'),
  );

  // --- 7. PR range-bounded (same exercise, 30-day window) ---
  await run('7. Personal records, 30-day range, same exercise', () =>
    personalRecordsRepository.findCandidates(PERF_USER, 'bench press', {
      from: new Date(Date.UTC(2026, 8, 1)),
      to: new Date(Date.UTC(2026, 8, 30)),
    }),
  );

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
