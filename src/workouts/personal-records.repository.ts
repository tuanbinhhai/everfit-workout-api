import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PrCandidateRow {
  id: string;
  reps: number;
  weightKg: string;
  date: string;
  rnWeight: number;
  rnVolume: number;
  rn1Rm: number;
}

export interface PrDateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class PersonalRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Raw SQL (docs/ARCHITECTURE.md §5.3): Prisma's query builder has no
  // equivalent of ROW_NUMBER() OVER (...), which is what makes this ranking
  // query genuinely need raw SQL — unlike Step 8's filters/joins, which
  // Prisma's builder expressed directly. $queryRaw's tagged template
  // parameterizes ${userId}/${exerciseNameNormalized}/range bounds safely
  // by construction (not string concatenation).
  //
  // Metrics mirror the pure functions in pr-calculations.ts:
  //   volume    = reps * weight_kg             (calculateVolume)
  //   epley_1rm = weight_kg * (1 + reps/30.0)  (calculateEpley1Rm)
  //
  // Ranking happens entirely on canonical weight_kg (never original
  // weight/unit), with a fully deterministic tiebreak: metric DESC, then
  // date ASC (earliest achievement wins a tie), then id ASC.
  //
  // `range` is optional: omitted for the plain (Step 9) full-history PR
  // lookup, supplied (inclusive both ends) for Step 10's range comparison —
  // same query, same ranking semantics, no duplicated ranking logic.
  async findCandidates(
    userId: string,
    exerciseNameNormalized: string,
    range?: PrDateRange,
  ): Promise<PrCandidateRow[]> {
    const rangeFilter = range
      ? Prisma.sql`AND e.date >= ${range.from} AND e.date <= ${range.to}`
      : Prisma.empty;

    return this.prisma.$queryRaw<PrCandidateRow[]>`
      WITH scoped_sets AS (
        SELECT
          s.id,
          s.reps,
          s.weight_kg,
          e.date,
          s.weight_kg AS max_weight_metric,
          (s.reps * s.weight_kg) AS volume_metric,
          (s.weight_kg * (1 + s.reps / 30.0)) AS epley_1rm_metric
        FROM workout_sets s
        JOIN workout_entries e ON e.id = s.workout_entry_id
        WHERE e.user_id = ${userId}
          AND e.exercise_name_normalized = ${exerciseNameNormalized}
          ${rangeFilter}
      ),
      ranked AS (
        SELECT
          id,
          reps,
          weight_kg,
          date,
          ROW_NUMBER() OVER (ORDER BY max_weight_metric DESC, date ASC, id ASC) AS rn_weight,
          ROW_NUMBER() OVER (ORDER BY volume_metric DESC, date ASC, id ASC) AS rn_volume,
          ROW_NUMBER() OVER (ORDER BY epley_1rm_metric DESC, date ASC, id ASC) AS rn_1rm
        FROM scoped_sets
      )
      SELECT
        id::text AS id,
        reps,
        weight_kg::text AS "weightKg",
        date::text AS date,
        rn_weight::int AS "rnWeight",
        rn_volume::int AS "rnVolume",
        rn_1rm::int AS "rn1Rm"
      FROM ranked
      WHERE rn_weight = 1 OR rn_volume = 1 OR rn_1rm = 1;
    `;
  }
}
