import { Injectable } from '@nestjs/common';
import { normalizeExerciseName } from '../common/normalize-exercise-name';
import { PrismaService } from '../prisma/prisma.service';
import { MuscleGroupProvider } from './muscle-group-provider.interface';

@Injectable()
export class PrismaMuscleGroupProvider implements MuscleGroupProvider {
  constructor(private readonly prisma: PrismaService) {}

  async getMuscleGroup(exerciseName: string): Promise<string | null> {
    const exerciseNameNormalized = normalizeExerciseName(exerciseName);
    const mapping = await this.prisma.exerciseMuscleGroup.findUnique({
      where: { exerciseNameNormalized },
    });
    return mapping?.muscleGroup ?? null;
  }

  async listExerciseNames(muscleGroup: string): Promise<string[]> {
    const rows = await this.prisma.exerciseMuscleGroup.findMany({
      where: { muscleGroup: normalizeExerciseName(muscleGroup) },
      select: { exerciseNameNormalized: true },
    });
    return rows.map((row) => row.exerciseNameNormalized);
  }
}
