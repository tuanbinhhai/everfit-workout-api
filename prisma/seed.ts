import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeExerciseName } from '../src/common/normalize-exercise-name';
import { PrismaClient } from '../src/generated/prisma/client';

// Small, demo-sized seed set — not a product exercise catalog.
const EXERCISE_MUSCLE_GROUPS: Array<{ name: string; muscleGroup: string }> = [
  { name: 'Bench Press', muscleGroup: 'chest' },
  { name: 'Incline Bench Press', muscleGroup: 'chest' },
  { name: 'Squat', muscleGroup: 'legs' },
  { name: 'Deadlift', muscleGroup: 'back' },
  { name: 'Barbell Row', muscleGroup: 'back' },
  { name: 'Overhead Press', muscleGroup: 'shoulders' },
  { name: 'Bicep Curl', muscleGroup: 'arms' },
];

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    for (const { name, muscleGroup } of EXERCISE_MUSCLE_GROUPS) {
      const exerciseNameNormalized = normalizeExerciseName(name);
      await prisma.exerciseMuscleGroup.upsert({
        where: { exerciseNameNormalized },
        update: { muscleGroup },
        create: { exerciseNameNormalized, muscleGroup },
      });
    }
    console.log(
      `Seeded ${EXERCISE_MUSCLE_GROUPS.length} exercise-to-muscle-group mappings.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
