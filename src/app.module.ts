import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { validateEnv } from './config/validate-env';
import { createPinoHttpOptions } from './common/logging/pino-http-options';
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
    // Registered only once, here in the root module, per nestjs-pino's own
    // requirement — re-importing it into a feature module would silently
    // double-register the request logging middleware.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createPinoHttpOptions,
    }),
    PrismaModule,
    ExerciseMetadataModule,
    UnitConversionModule,
    WorkoutsModule,
    HealthModule,
  ],
})
export class AppModule {}
