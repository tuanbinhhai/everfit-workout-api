import { IsInt, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateWorkoutSetDto {
  @IsInt()
  @Min(1)
  reps!: number;

  @IsNumber()
  @Min(0)
  weight!: number;

  @IsString()
  @IsNotEmpty()
  unit!: string;
}
