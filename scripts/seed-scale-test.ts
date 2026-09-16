// Generates a deterministic, reproducible 50k+ workout-entry dataset for one
// user, for the Step 12 performance verification (docs/PERFORMANCE_NOTES.md).
// This is NOT part of `npm test` or the normal dev seed (prisma/seed.ts) —
// run explicitly via `npm run perf:seed`, and remove via `npm run perf:clean`.
//
// Deterministic by construction (index-based arithmetic, no RNG), so the same
// dataset shape is produced every run.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeExerciseName } from '../src/common/normalize-exercise-name';
import { PrismaClient } from '../src/generated/prisma/client';
import { UnitConversionService } from '../src/unit-conversion/unit-conversion.service';

export const PERF_USER = 'perf-user';
export const PERF_USER_SECONDARY = 'perf-user-2';

// One exercise (Bench Press) deliberately gets a disproportionate share —
// the worst-case single-exercise concentration scenario docs/ARCHITECTURE.md
// §5.2 says the PR query's cost model must hold up against, not just an
// evenly-distributed "typical" case.
const EXERCISE_SHARES: Array<{ name: string; count: number }> = [
  { name: 'Bench Press', count: 20_000 },
  { name: 'Squat', count: 3_750 },
  { name: 'Deadlift', count: 3_750 },
  { name: 'Incline Bench Press', count: 3_750 },
  { name: 'Barbell Row', count: 3_750 },
  { name: 'Overhead Press', count: 3_750 },
  { name: 'Bicep Curl', count: 3_750 },
  { name: 'Leg Press', count: 3_750 }, // deliberately NOT in exercise_muscle_groups
  { name: 'Lat Pulldown', count: 3_750 }, // deliberately NOT in exercise_muscle_groups
];

const TOTAL_ENTRIES = EXERCISE_SHARES.reduce((sum, e) => sum + e.count, 0); // 50,000
const SECONDARY_USER_ENTRIES = 200;

const BASE_DATE_MS = Date.UTC(2026, 8, 15); // 2026-09-15
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_SPAN_DAYS = 730; // ~2 years of history

const BATCH_SIZE = 2_000;

const unitConversion = new UnitConversionService();

interface EntryPlan {
  index: number;
  userId: string;
  exerciseName: string;
  date: Date;
}

function planEntries(
  userId: string,
  exercises: Array<{ name: string; count: number }>,
  startIndex: number,
): EntryPlan[] {
  const plans: EntryPlan[] = [];
  let index = startIndex;
  for (const exercise of exercises) {
    for (let i = 0; i < exercise.count; i++) {
      const dayOffset = index % DATE_SPAN_DAYS;
      const date = new Date(BASE_DATE_MS - dayOffset * DAY_MS);
      plans.push({ index, userId, exerciseName: exercise.name, date });
      index++;
    }
  }
  return plans;
}

function setsForEntry(index: number): Array<{
  setIndex: number;
  reps: number;
  weight: string;
  unit: string;
  weightKg: string;
}> {
  const setCount = 3 + (index % 3); // 3, 4, or 5 sets — averages 4
  const unit = index % 7 === 0 ? 'lb' : 'kg';
  const sets = [];
  for (let s = 0; s < setCount; s++) {
    const reps = 3 + ((index + s) % 10); // 3-12
    const weight = 40 + ((index + s * 5) % 120); // 40-159
    const weightKg = unitConversion.toKg(weight, unit);
    sets.push({
      setIndex: s,
      reps,
      weight: weight.toString(),
      unit,
      weightKg: weightKg.toFixed(4),
    });
  }
  return sets;
}

async function insertBatch(
  prisma: PrismaClient,
  batch: EntryPlan[],
): Promise<void> {
  const createdEntries = await prisma.workoutEntry.createManyAndReturn({
    data: batch.map((plan) => ({
      userId: plan.userId,
      exerciseName: plan.exerciseName,
      exerciseNameNormalized: normalizeExerciseName(plan.exerciseName),
      date: plan.date,
    })),
  });

  const setsData = createdEntries.flatMap((entry, i) =>
    setsForEntry(batch[i].index).map((set) => ({
      workoutEntryId: entry.id,
      ...set,
    })),
  );

  await prisma.workoutSet.createMany({ data: setsData });
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const existingPrimary = await prisma.workoutEntry.count({
      where: { userId: PERF_USER },
    });
    if (existingPrimary > 0) {
      console.log(
        `${PERF_USER} already has ${existingPrimary} entries. Run "npm run perf:clean" first to reseed from scratch.`,
      );
      return;
    }

    const primaryPlans = planEntries(PERF_USER, EXERCISE_SHARES, 0);
    const secondaryPlans = planEntries(
      PERF_USER_SECONDARY,
      [{ name: 'Bench Press', count: SECONDARY_USER_ENTRIES }],
      TOTAL_ENTRIES,
    );
    const allPlans = [...primaryPlans, ...secondaryPlans];

    console.log(
      `Seeding ${allPlans.length} workout entries (${TOTAL_ENTRIES} for ${PERF_USER}, ${SECONDARY_USER_ENTRIES} for ${PERF_USER_SECONDARY})...`,
    );

    let totalSets = 0;
    const startedAt = Date.now();
    for (let i = 0; i < allPlans.length; i += BATCH_SIZE) {
      const batch = allPlans.slice(i, i + BATCH_SIZE);
      await insertBatch(prisma, batch);
      totalSets += batch.reduce(
        (sum, plan) => sum + setsForEntry(plan.index).length,
        0,
      );
      console.log(
        `  ${Math.min(i + BATCH_SIZE, allPlans.length)}/${allPlans.length} entries (${totalSets} sets so far)`,
      );
    }

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Done in ${elapsedSeconds}s. Total entries: ${allPlans.length}, total sets: ${totalSets}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

// clean-scale-test.ts and explain-queries.ts import PERF_USER /
// PERF_USER_SECONDARY from this module for their own use. Without this
// guard, that import alone would trigger a full reseed as a side effect
// (discovered for real: it raced with clean-scale-test.ts's own deleteMany
// calls and silently re-seeded 50,200 rows during what was meant to be a
// cleanup run).
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
