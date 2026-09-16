import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsCalendarDate } from '../../common/validators/is-calendar-date.validator';
import { IsOnOrBefore } from '../../common/validators/is-on-or-before.validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PersonalRecordsCompareQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  exerciseName!: string;

  @IsCalendarDate()
  @IsOnOrBefore('currentTo')
  currentFrom!: string;

  @IsCalendarDate()
  currentTo!: string;

  @IsCalendarDate()
  @IsOnOrBefore('previousTo')
  previousFrom!: string;

  @IsCalendarDate()
  previousTo!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;
}
