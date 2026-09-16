import { Injectable } from '@nestjs/common';
import { normalizeExerciseName } from '../common/normalize-exercise-name';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import { PersonalRecordsQueryDto } from './dto/personal-records-query.dto';
import {
  PersonalRecordsRepository,
  PrCandidateRow,
} from './personal-records.repository';
import { calculateEpley1Rm, calculateVolume } from './pr-calculations';

export interface HeaviestSetRecord {
  weight: string;
  reps: number;
  date: string;
  unit: string;
}

export interface HighestVolumeSetRecord {
  weight: string;
  reps: number;
  volume: string;
  date: string;
  unit: string;
}

export interface Best1RmRecord {
  estimated1Rm: string;
  weight: string;
  reps: number;
  date: string;
  unit: string;
}

export interface PersonalRecordsResult {
  userId: string;
  exerciseName: string;
  unit: string;
  hasData: boolean;
  heaviestSet: HeaviestSetRecord | null;
  highestVolumeSet: HighestVolumeSetRecord | null;
  best1Rm: Best1RmRecord | null;
  message?: string;
}

const NO_DATA_MESSAGE = 'No workout data found for this user and exercise.';

@Injectable()
export class PersonalRecordsService {
  constructor(
    private readonly repository: PersonalRecordsRepository,
    private readonly unitConversion: UnitConversionService,
  ) {}

  async getPersonalRecords(
    query: PersonalRecordsQueryDto,
  ): Promise<PersonalRecordsResult> {
    const unit = query.unit ?? 'kg';
    if (!this.unitConversion.isSupported(unit)) {
      throw new UnsupportedUnitError(unit);
    }

    const exerciseNameNormalized = normalizeExerciseName(query.exerciseName);
    const candidates = await this.repository.findCandidates(
      query.userId,
      exerciseNameNormalized,
    );

    const weightWinner = candidates.find((row) => row.rnWeight === 1);
    const volumeWinner = candidates.find((row) => row.rnVolume === 1);
    const oneRmWinner = candidates.find((row) => row.rn1Rm === 1);

    if (!weightWinner || !volumeWinner || !oneRmWinner) {
      return {
        userId: query.userId,
        exerciseName: query.exerciseName,
        unit,
        hasData: false,
        heaviestSet: null,
        highestVolumeSet: null,
        best1Rm: null,
        message: NO_DATA_MESSAGE,
      };
    }

    return {
      userId: query.userId,
      exerciseName: query.exerciseName,
      unit,
      hasData: true,
      heaviestSet: this.toHeaviestSetRecord(weightWinner, unit),
      highestVolumeSet: this.toHighestVolumeSetRecord(volumeWinner, unit),
      best1Rm: this.toBest1RmRecord(oneRmWinner, unit),
    };
  }

  private toHeaviestSetRecord(
    row: PrCandidateRow,
    unit: string,
  ): HeaviestSetRecord {
    const weightKg = Number(row.weightKg);
    return {
      weight: this.unitConversion.fromKg(weightKg, unit).toFixed(2),
      reps: row.reps,
      date: row.date,
      unit,
    };
  }

  private toHighestVolumeSetRecord(
    row: PrCandidateRow,
    unit: string,
  ): HighestVolumeSetRecord {
    const weightKg = Number(row.weightKg);
    const volumeKg = calculateVolume(weightKg, row.reps);
    return {
      weight: this.unitConversion.fromKg(weightKg, unit).toFixed(2),
      reps: row.reps,
      volume: this.unitConversion.fromKg(volumeKg, unit).toFixed(2),
      date: row.date,
      unit,
    };
  }

  private toBest1RmRecord(row: PrCandidateRow, unit: string): Best1RmRecord {
    const weightKg = Number(row.weightKg);
    const oneRmKg = calculateEpley1Rm(weightKg, row.reps);
    return {
      estimated1Rm: this.unitConversion.fromKg(oneRmKg, unit).toFixed(2),
      weight: this.unitConversion.fromKg(weightKg, unit).toFixed(2),
      reps: row.reps,
      date: row.date,
      unit,
    };
  }
}
