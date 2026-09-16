// Removes the Step 12 performance dataset (see seed-scale-test.ts), scoped
// strictly to the perf-user ids so normal dev/manual-verification data is
// never touched.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PERF_USER, PERF_USER_SECONDARY } from './seed-scale-test';

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const userIds = [PERF_USER, PERF_USER_SECONDARY];
    const sets = await prisma.workoutSet.deleteMany({
      where: { entry: { userId: { in: userIds } } },
    });
    const entries = await prisma.workoutEntry.deleteMany({
      where: { userId: { in: userIds } },
    });
    console.log(
      `Removed ${entries.count} entries and ${sets.count} sets for ${userIds.join(', ')}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
