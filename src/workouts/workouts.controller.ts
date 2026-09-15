import { Body, Controller, Post } from '@nestjs/common';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import { WorkoutEntryResponse, WorkoutsService } from './workouts.service';

@Controller('workouts')
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  async create(
    @Body() dto: BulkCreateWorkoutDto,
  ): Promise<{ entries: WorkoutEntryResponse[] }> {
    return this.workoutsService.logWorkouts(dto);
  }
}
