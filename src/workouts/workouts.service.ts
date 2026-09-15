import { Injectable } from '@nestjs/common';
import { formatCalendarDate, parseCalendarDate } from '../common/calendar-date';
import { normalizeExerciseName } from '../common/normalize-exercise-name';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import { WorkoutEntryInput, WorkoutsRepository } from './workouts.repository';

export interface WorkoutSetResponse {
  id: string;
  setIndex: number;
  reps: number;
  weight: string;
  unit: string;
  weightKg: string;
}

export interface WorkoutEntryResponse {
  id: string;
  userId: string;
  exerciseName: string;
  date: string;
  sets: WorkoutSetResponse[];
}

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly repository: WorkoutsRepository,
    private readonly unitConversion: UnitConversionService,
  ) {}

  async logWorkouts(
    dto: BulkCreateWorkoutDto,
  ): Promise<{ entries: WorkoutEntryResponse[] }> {
    const entries: WorkoutEntryInput[] = dto.entries.map((entry) => ({
      userId: entry.userId,
      exerciseName: entry.exerciseName,
      exerciseNameNormalized: normalizeExerciseName(entry.exerciseName),
      date: parseCalendarDate(entry.date),
      sets: entry.sets.map((set, index) => ({
        setIndex: index,
        reps: set.reps,
        weight: set.weight.toString(),
        unit: set.unit,
        weightKg: this.unitConversion.toKg(set.weight, set.unit).toString(),
      })),
    }));

    const created = await this.repository.createMany(entries);

    return {
      entries: created.map((entry) => ({
        id: entry.id.toString(),
        userId: entry.userId,
        exerciseName: entry.exerciseName,
        date: formatCalendarDate(entry.date),
        sets: entry.sets.map((set) => ({
          id: set.id.toString(),
          setIndex: set.setIndex,
          reps: set.reps,
          weight: String(set.weight),
          unit: set.unit,
          weightKg: String(set.weightKg),
        })),
      })),
    };
  }
}
