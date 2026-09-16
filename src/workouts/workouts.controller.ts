import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import { PersonalRecordsCompareQueryDto } from './dto/personal-records-compare-query.dto';
import { PersonalRecordsQueryDto } from './dto/personal-records-query.dto';
import { WorkoutHistoryQueryDto } from './dto/workout-history-query.dto';
import {
  PersonalRecordsCompareResult,
  PersonalRecordsResult,
  PersonalRecordsService,
} from './personal-records.service';
import {
  WorkoutEntryResponse,
  WorkoutHistoryResult,
  WorkoutsService,
} from './workouts.service';

@Controller('workouts')
export class WorkoutsController {
  constructor(
    private readonly workoutsService: WorkoutsService,
    private readonly personalRecordsService: PersonalRecordsService,
  ) {}

  @Post()
  async create(
    @Body() dto: BulkCreateWorkoutDto,
  ): Promise<{ entries: WorkoutEntryResponse[] }> {
    return this.workoutsService.logWorkouts(dto);
  }

  @Get()
  async history(
    @Query() query: WorkoutHistoryQueryDto,
  ): Promise<WorkoutHistoryResult> {
    return this.workoutsService.getHistory(query);
  }

  @Get('prs')
  async personalRecords(
    @Query() query: PersonalRecordsQueryDto,
  ): Promise<PersonalRecordsResult> {
    return this.personalRecordsService.getPersonalRecords(query);
  }

  @Get('prs/compare')
  async comparePersonalRecords(
    @Query() query: PersonalRecordsCompareQueryDto,
  ): Promise<PersonalRecordsCompareResult> {
    return this.personalRecordsService.comparePersonalRecords(query);
  }
}
