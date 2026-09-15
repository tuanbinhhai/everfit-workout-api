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
}
