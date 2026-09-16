import { Injectable } from '@nestjs/common';
import { parseCalendarDate } from '../common/calendar-date';
import { normalizeExerciseName } from '../common/normalize-exercise-name';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import { PersonalRecordsCompareQueryDto } from './dto/personal-records-compare-query.dto';
import { PersonalRecordsQueryDto } from './dto/personal-records-query.dto';
import {
  PersonalRecordsRepository,
  PrCandidateRow,
  PrDateRange,
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

export interface PersonalRecordsRangeResult {
  from: string;
  to: string;
  hasData: boolean;
  heaviestSet: HeaviestSetRecord | null;
  highestVolumeSet: HighestVolumeSetRecord | null;
  best1Rm: Best1RmRecord | null;
  message?: string;
}

export interface PrMetricDelta {
  // Absolute delta, in the requested display unit. Null only when either
  // range has no data for this metric (never a stand-in for zero).
  absolute: string | null;
  // Percentage delta — unit-independent by construction (computed from the
  // canonical-kg ratio), so this is the same number regardless of the
  // requested display unit. Null when either range has no data, or when
  // the previous value is exactly zero (division by zero is undefined —
  // never returned as Infinity/NaN).
  percentage: string | null;
}

export interface PersonalRecordsDelta {
  heaviestSet: PrMetricDelta;
  // "Volume" has reps × weight-unit semantics, not a plain weight — but for
  // display purposes it is converted with the same linear kg -> requested
  // unit factor as weight/1RM (this is mathematically consistent: volume is
  // linear in weightKg, so scaling by the conversion factor before or after
  // computing volume gives the same result). Documented here rather than
  // silently treating it as an ordinary weight value.
  highestVolumeSet: PrMetricDelta;
  best1Rm: PrMetricDelta;
}

export interface PersonalRecordsCompareResult {
  userId: string;
  exerciseName: string;
  unit: string;
  current: PersonalRecordsRangeResult;
  previous: PersonalRecordsRangeResult;
  delta: PersonalRecordsDelta;
}

interface CanonicalMetrics {
  weightKg: number | null;
  volumeKg: number | null;
  oneRmKg: number | null;
}

interface WinnersAndMetrics {
  hasData: boolean;
  heaviestSet: HeaviestSetRecord | null;
  highestVolumeSet: HighestVolumeSetRecord | null;
  best1Rm: Best1RmRecord | null;
  canonicalMetrics: CanonicalMetrics;
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
    const unit = this.resolveUnit(query.unit);
    const exerciseNameNormalized = normalizeExerciseName(query.exerciseName);

    const { canonicalMetrics: _canonicalMetrics, ...winners } =
      await this.computeWinnersAndMetrics(
        query.userId,
        exerciseNameNormalized,
        unit,
      );
    void _canonicalMetrics;

    return {
      userId: query.userId,
      exerciseName: query.exerciseName,
      unit,
      ...winners,
      ...(winners.hasData ? {} : { message: NO_DATA_MESSAGE }),
    };
  }

  async comparePersonalRecords(
    query: PersonalRecordsCompareQueryDto,
  ): Promise<PersonalRecordsCompareResult> {
    const unit = this.resolveUnit(query.unit);
    const exerciseNameNormalized = normalizeExerciseName(query.exerciseName);

    const [current, previous] = await Promise.all([
      this.computeWinnersAndMetrics(
        query.userId,
        exerciseNameNormalized,
        unit,
        {
          from: parseCalendarDate(query.currentFrom),
          to: parseCalendarDate(query.currentTo),
        },
      ),
      this.computeWinnersAndMetrics(
        query.userId,
        exerciseNameNormalized,
        unit,
        {
          from: parseCalendarDate(query.previousFrom),
          to: parseCalendarDate(query.previousTo),
        },
      ),
    ]);

    return {
      userId: query.userId,
      exerciseName: query.exerciseName,
      unit,
      current: this.toRangeResult(current, query.currentFrom, query.currentTo),
      previous: this.toRangeResult(
        previous,
        query.previousFrom,
        query.previousTo,
      ),
      delta: {
        heaviestSet: this.computeMetricDelta(
          current.canonicalMetrics.weightKg,
          previous.canonicalMetrics.weightKg,
          unit,
        ),
        highestVolumeSet: this.computeMetricDelta(
          current.canonicalMetrics.volumeKg,
          previous.canonicalMetrics.volumeKg,
          unit,
        ),
        best1Rm: this.computeMetricDelta(
          current.canonicalMetrics.oneRmKg,
          previous.canonicalMetrics.oneRmKg,
          unit,
        ),
      },
    };
  }

  private resolveUnit(requestedUnit: string | undefined): string {
    const unit = requestedUnit ?? 'kg';
    if (!this.unitConversion.isSupported(unit)) {
      throw new UnsupportedUnitError(unit);
    }
    return unit;
  }

  // Shared by both getPersonalRecords (no range = full history) and
  // comparePersonalRecords (range = one side of the comparison) — the PR
  // ranking algorithm itself lives only in PersonalRecordsRepository, never
  // duplicated here or between these two call sites.
  private async computeWinnersAndMetrics(
    userId: string,
    exerciseNameNormalized: string,
    unit: string,
    range?: PrDateRange,
  ): Promise<WinnersAndMetrics> {
    const candidates = await this.repository.findCandidates(
      userId,
      exerciseNameNormalized,
      range,
    );

    const weightWinner = candidates.find((row) => row.rnWeight === 1);
    const volumeWinner = candidates.find((row) => row.rnVolume === 1);
    const oneRmWinner = candidates.find((row) => row.rn1Rm === 1);

    if (!weightWinner || !volumeWinner || !oneRmWinner) {
      return {
        hasData: false,
        heaviestSet: null,
        highestVolumeSet: null,
        best1Rm: null,
        canonicalMetrics: { weightKg: null, volumeKg: null, oneRmKg: null },
      };
    }

    return {
      hasData: true,
      heaviestSet: this.toHeaviestSetRecord(weightWinner, unit),
      highestVolumeSet: this.toHighestVolumeSetRecord(volumeWinner, unit),
      best1Rm: this.toBest1RmRecord(oneRmWinner, unit),
      canonicalMetrics: {
        weightKg: Number(weightWinner.weightKg),
        volumeKg: calculateVolume(
          Number(volumeWinner.weightKg),
          volumeWinner.reps,
        ),
        oneRmKg: calculateEpley1Rm(
          Number(oneRmWinner.weightKg),
          oneRmWinner.reps,
        ),
      },
    };
  }

  private toRangeResult(
    winners: WinnersAndMetrics,
    from: string,
    to: string,
  ): PersonalRecordsRangeResult {
    return {
      from,
      to,
      hasData: winners.hasData,
      heaviestSet: winners.heaviestSet,
      highestVolumeSet: winners.highestVolumeSet,
      best1Rm: winners.best1Rm,
      ...(winners.hasData ? {} : { message: NO_DATA_MESSAGE }),
    };
  }

  // Delta is computed entirely from canonical kg-space values (never from
  // rounded display strings), then converted to the requested unit only for
  // the final absolute value. Percentage is unit-independent by
  // construction, so it is never converted.
  private computeMetricDelta(
    currentKg: number | null,
    previousKg: number | null,
    unit: string,
  ): PrMetricDelta {
    if (currentKg === null || previousKg === null) {
      return { absolute: null, percentage: null };
    }

    const absoluteKg = currentKg - previousKg;
    const absolute = this.unitConversion.fromKg(absoluteKg, unit).toFixed(2);
    const percentage =
      previousKg === 0 ? null : ((absoluteKg / previousKg) * 100).toFixed(2);

    return { absolute, percentage };
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
