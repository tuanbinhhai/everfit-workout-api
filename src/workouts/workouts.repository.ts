import { Injectable } from '@nestjs/common';
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

@Injectable()
export class WorkoutsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
}
