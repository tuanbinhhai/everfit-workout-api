import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.validator';
import { IsOnOrBefore } from '../../common/validators/is-on-or-before.validator';
import { MAX_PAGE_SIZE } from '../workouts.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class WorkoutHistoryQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  exerciseName?: string;

  @IsOptional()
  @IsCalendarDate()
  @IsOnOrBefore('to')
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  muscleGroup?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}
