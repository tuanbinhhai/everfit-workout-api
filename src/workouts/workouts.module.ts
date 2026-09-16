import { Module } from '@nestjs/common';
import { ExerciseMetadataModule } from '../exercise-metadata/exercise-metadata.module';
import { UnitConversionModule } from '../unit-conversion/unit-conversion.module';
import { PersonalRecordsRepository } from './personal-records.repository';
import { PersonalRecordsService } from './personal-records.service';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

@Module({
  imports: [UnitConversionModule, ExerciseMetadataModule],
  controllers: [WorkoutsController],
  providers: [
    WorkoutsService,
    WorkoutsRepository,
    PersonalRecordsService,
    PersonalRecordsRepository,
  ],
})
export class WorkoutsModule {}
