import { Inject, Injectable } from '@nestjs/common';
import {
  MUSCLE_GROUP_PROVIDER,
  MuscleGroupProvider,
} from '../exercise-metadata/muscle-group-provider.interface';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface WorkoutSetInput {
  setIndex: number;
  reps: number;
  weight: string;
  unit: string;
  weightKg: string;
}

export interface WorkoutEntryInput {
  userId: string;
  exerciseName: string;
  exerciseNameNormalized: string;
  date: Date;
  sets: WorkoutSetInput[];
}

export interface CreatedWorkoutSet {
  id: bigint;
  setIndex: number;
  reps: number;
  weight: unknown;
  unit: string;
  weightKg: unknown;
}

export interface CreatedWorkoutEntry {
  id: bigint;
  userId: string;
  exerciseName: string;
  date: Date;
  sets: CreatedWorkoutSet[];
}

export interface WorkoutHistoryFilter {
  userId: string;
  exerciseNameSubstring?: string;
  muscleGroup?: string;
  from?: Date;
  to?: Date;
  cursor?: { date: Date; id: bigint };
  limit: number;
}

export interface WorkoutHistoryPage {
  entries: CreatedWorkoutEntry[];
  hasMore: boolean;
}

@Injectable()
export class WorkoutsRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MUSCLE_GROUP_PROVIDER)
    private readonly muscleGroupProvider: MuscleGroupProvider,
  ) {}

  async createMany(
    entries: WorkoutEntryInput[],
  ): Promise<CreatedWorkoutEntry[]> {
    return this.prisma.$transaction(async (tx) => {
      const createdEntries = await tx.workoutEntry.createManyAndReturn({
        data: entries.map((entry) => ({
          userId: entry.userId,
          exerciseName: entry.exerciseName,
          exerciseNameNormalized: entry.exerciseNameNormalized,
          date: entry.date,
        })),
      });

      const setsData = createdEntries.flatMap((created, index) =>
        entries[index].sets.map((set) => ({
          workoutEntryId: created.id,
          setIndex: set.setIndex,
          reps: set.reps,
          weight: set.weight,
          unit: set.unit,
          weightKg: set.weightKg,
        })),
      );

      const createdSets =
        setsData.length > 0
          ? await tx.workoutSet.createManyAndReturn({ data: setsData })
          : [];

      return createdEntries.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        exerciseName: entry.exerciseName,
        date: entry.date,
        sets: createdSets
          .filter((set) => set.workoutEntryId === entry.id)
          .sort((a, b) => a.setIndex - b.setIndex),
      }));
    });
  }

  async findHistory(filter: WorkoutHistoryFilter): Promise<WorkoutHistoryPage> {
    let muscleGroupExerciseNames: string[] | undefined;
    if (filter.muscleGroup) {
      muscleGroupExerciseNames =
        await this.muscleGroupProvider.listExerciseNames(filter.muscleGroup);
      if (muscleGroupExerciseNames.length === 0) {
        return { entries: [], hasMore: false };
      }
    }

    const exerciseNameFilter: Prisma.WorkoutEntryWhereInput['exerciseNameNormalized'] =
      filter.exerciseNameSubstring || muscleGroupExerciseNames
        ? {
            ...(filter.exerciseNameSubstring
              ? { contains: filter.exerciseNameSubstring }
              : {}),
            ...(muscleGroupExerciseNames
              ? { in: muscleGroupExerciseNames }
              : {}),
          }
        : undefined;

    const dateFilter: Prisma.WorkoutEntryWhereInput['date'] =
      filter.from || filter.to
        ? {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          }
        : undefined;

    const where: Prisma.WorkoutEntryWhereInput = {
      userId: filter.userId,
      ...(exerciseNameFilter
        ? { exerciseNameNormalized: exerciseNameFilter }
        : {}),
      ...(dateFilter ? { date: dateFilter } : {}),
      ...(filter.cursor
        ? {
            OR: [
              { date: { lt: filter.cursor.date } },
              { date: filter.cursor.date, id: { lt: filter.cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.workoutEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: filter.limit + 1,
      include: { sets: { orderBy: { setIndex: 'asc' } } },
    });

    const hasMore = rows.length > filter.limit;
    const entries = hasMore ? rows.slice(0, filter.limit) : rows;

    return { entries, hasMore };
  }
}
