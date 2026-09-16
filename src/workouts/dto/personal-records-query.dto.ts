import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PersonalRecordsQueryDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  exerciseName!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unit?: string;
}
