import { Module } from '@nestjs/common';
import { MUSCLE_GROUP_PROVIDER } from './muscle-group-provider.interface';
import { PrismaMuscleGroupProvider } from './prisma-muscle-group.provider';

@Module({
  providers: [
    { provide: MUSCLE_GROUP_PROVIDER, useClass: PrismaMuscleGroupProvider },
  ],
  exports: [MUSCLE_GROUP_PROVIDER],
})
export class ExerciseMetadataModule {}
