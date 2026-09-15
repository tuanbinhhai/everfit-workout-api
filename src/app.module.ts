import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnv } from './config/validate-env';
import { ExerciseMetadataModule } from './exercise-metadata/exercise-metadata.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { UnitConversionModule } from './unit-conversion/unit-conversion.module';
import { WorkoutsModule } from './workouts/workouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PrismaModule,
    ExerciseMetadataModule,
    UnitConversionModule,
    WorkoutsModule,
    HealthModule,
  ],
})
export class AppModule {}
