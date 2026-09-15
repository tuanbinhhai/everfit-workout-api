import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.validator';
import { CreateWorkoutSetDto } from './create-workout-set.dto';

export class CreateWorkoutEntryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsCalendarDate()
  date!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  exerciseName!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutSetDto)
  sets!: CreateWorkoutSetDto[];
}
