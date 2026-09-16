import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatCalendarDate, parseCalendarDate } from '../common/calendar-date';
import { normalizeExerciseName } from '../common/normalize-exercise-name';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import { decodeCursor, encodeCursor } from './cursor';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import { WorkoutHistoryQueryDto } from './dto/workout-history-query.dto';
import {
  CreatedWorkoutEntry,
  WorkoutEntryInput,
  WorkoutsRepository,
} from './workouts.repository';

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

export interface WorkoutHistorySetResponse {
  id: string;
  setIndex: number;
  reps: number;
  originalWeight: string;
  originalUnit: string;
  convertedWeight: string;
  unit: string;
}

export interface WorkoutHistoryEntryResponse {
  id: string;
  userId: string;
  exerciseName: string;
  date: string;
  sets: WorkoutHistorySetResponse[];
}

export interface WorkoutHistoryResult {
  data: WorkoutHistoryEntryResponse[];
  pagination: { nextCursor: string | null; hasMore: boolean };
  message?: string;
}

const DEFAULT_PAGE_SIZE_FALLBACK = 20;

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly repository: WorkoutsRepository,
    private readonly unitConversion: UnitConversionService,
    private readonly config: ConfigService,
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

  async getHistory(
    query: WorkoutHistoryQueryDto,
  ): Promise<WorkoutHistoryResult> {
    const unit = query.unit ?? 'kg';
    if (!this.unitConversion.isSupported(unit)) {
      throw new UnsupportedUnitError(unit);
    }

    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const limit =
      query.limit ??
      this.config.get<number>(
        'pagination.defaultPageSize',
        DEFAULT_PAGE_SIZE_FALLBACK,
      );

    const { entries, hasMore } = await this.repository.findHistory({
      userId: query.userId,
      exerciseNameSubstring: query.exerciseName
        ? normalizeExerciseName(query.exerciseName)
        : undefined,
      muscleGroup: query.muscleGroup,
      from: query.from ? parseCalendarDate(query.from) : undefined,
      to: query.to ? parseCalendarDate(query.to) : undefined,
      cursor: cursor
        ? { date: parseCalendarDate(cursor.date), id: BigInt(cursor.id) }
        : undefined,
      limit,
    });

    const data = entries.map((entry) => this.toHistoryResponse(entry, unit));
    const last = entries[entries.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            date: formatCalendarDate(last.date),
            id: last.id.toString(),
          })
        : null;

    return {
      data,
      pagination: { nextCursor, hasMore },
      ...(data.length === 0
        ? { message: 'No workout entries found for the specified criteria.' }
        : {}),
    };
  }

  private toHistoryResponse(
    entry: CreatedWorkoutEntry,
    unit: string,
  ): WorkoutHistoryEntryResponse {
    return {
      id: entry.id.toString(),
      userId: entry.userId,
      exerciseName: entry.exerciseName,
      date: formatCalendarDate(entry.date),
      sets: entry.sets.map((set) => ({
        id: set.id.toString(),
        setIndex: set.setIndex,
        reps: set.reps,
        originalWeight: String(set.weight),
        originalUnit: set.unit,
        // Display-boundary rounding only (docs/CLARIFICATIONS.md #11) — the
        // canonical weightKg comparison/storage value is never rounded.
        convertedWeight: this.unitConversion
          .fromKg(Number(set.weightKg), unit)
          .toFixed(2),
        unit,
      })),
    };
  }
}
