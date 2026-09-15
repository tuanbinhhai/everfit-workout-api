import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { MAX_BULK_ENTRIES } from '../workouts.constants';
import { CreateWorkoutEntryDto } from './create-workout-entry.dto';

export class BulkCreateWorkoutDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => CreateWorkoutEntryDto)
  entries!: CreateWorkoutEntryDto[];
}
