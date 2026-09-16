import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import {
  PrCandidateRow,
  PrDateRange,
  PersonalRecordsRepository,
} from './personal-records.repository';
import { PersonalRecordsService } from './personal-records.service';

function row(overrides: Partial<PrCandidateRow> = {}): PrCandidateRow {
  return {
    id: '1',
    reps: 5,
    weightKg: '100',
    date: '2026-09-01',
    rnWeight: 0,
    rnVolume: 0,
    rn1Rm: 0,
    ...overrides,
  };
}

type FindCandidatesArgs = [string, string, PrDateRange | undefined];

describe('PersonalRecordsService', () => {
  let service: PersonalRecordsService;
  let repository: {
    findCandidates: jest.Mock<Promise<PrCandidateRow[]>, FindCandidatesArgs>;
  };
  let unitConversion: UnitConversionService;

  beforeEach(() => {
    repository = {
      findCandidates: jest
        .fn<Promise<PrCandidateRow[]>, FindCandidatesArgs>()
        .mockResolvedValue([]),
    };
    unitConversion = new UnitConversionService();
    service = new PersonalRecordsService(
      repository as unknown as PersonalRecordsRepository,
      unitConversion,
    );
  });

  it('maps repository candidate rows to the correct PR fields', async () => {
    repository.findCandidates.mockResolvedValue([
      row({
        id: '10',
        weightKg: '150',
        reps: 3,
        date: '2026-09-05',
        rnWeight: 1,
      }),
      row({
        id: '11',
        weightKg: '80',
        reps: 12,
        date: '2026-09-10',
        rnVolume: 1,
      }),
      row({ id: '12', weightKg: '100', reps: 8, date: '2026-09-15', rn1Rm: 1 }),
    ]);

    const result = await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    });

    expect(result.hasData).toBe(true);
    expect(result.heaviestSet).toMatchObject({
      weight: '150.00',
      reps: 3,
      date: '2026-09-05',
    });
    expect(result.highestVolumeSet).toMatchObject({
      weight: '80.00',
      reps: 12,
      volume: '960.00', // 80 * 12
      date: '2026-09-10',
    });
    expect(result.best1Rm).toMatchObject({
      weight: '100.00',
      reps: 8,
      date: '2026-09-15',
    });
    // 100 * (1 + 8/30) = 126.666... -> 126.67
    expect(result.best1Rm?.estimated1Rm).toBe('126.67');
  });

  it('defaults output unit to kg', async () => {
    repository.findCandidates.mockResolvedValue([
      row({ rnWeight: 1, rnVolume: 1, rn1Rm: 1 }),
    ]);

    const result = await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    });

    expect(result.unit).toBe('kg');
    expect(result.heaviestSet?.unit).toBe('kg');
  });

  it('converts to the requested output unit', async () => {
    repository.findCandidates.mockResolvedValue([
      row({ weightKg: '100', rnWeight: 1, rnVolume: 1, rn1Rm: 1 }),
    ]);

    const result = await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      unit: 'lb',
    });

    expect(result.unit).toBe('lb');
    expect(result.heaviestSet?.unit).toBe('lb');
    expect(result.heaviestSet?.weight).toBe('220.46');
  });

  it('returns a hasData:false result with a message when there is no data', async () => {
    repository.findCandidates.mockResolvedValue([]);

    const result = await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    });

    expect(result.hasData).toBe(false);
    expect(result.heaviestSet).toBeNull();
    expect(result.highestVolumeSet).toBeNull();
    expect(result.best1Rm).toBeNull();
    expect(result.message).toBe(
      'No workout data found for this user and exercise.',
    );
  });

  it('normalizes exerciseName before passing it to the repository', async () => {
    await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: '  Bench   Press ',
    });

    expect(repository.findCandidates).toHaveBeenCalledWith(
      'user-1',
      'bench press',
      undefined,
    );
  });

  it('throws UnsupportedUnitError and never queries the repository for an unsupported unit', async () => {
    await expect(
      service.getPersonalRecords({
        userId: 'user-1',
        exerciseName: 'Bench Press',
        unit: 'oz',
      }),
    ).rejects.toThrow(UnsupportedUnitError);

    expect(repository.findCandidates).not.toHaveBeenCalled();
  });

  it('applies unit conversion only after selecting each metric winner, not before', async () => {
    // Three distinct winner rows prove each PR field is derived from its
    // own designated winner row (selected first), then converted — not
    // from some single row picked before selection, and not from a value
    // computed before the winner was known.
    repository.findCandidates.mockResolvedValue([
      row({
        id: '1',
        weightKg: '999',
        reps: 1,
        date: '2026-01-01',
        rnWeight: 1,
      }),
      row({
        id: '2',
        weightKg: '10',
        reps: 50,
        date: '2026-02-01',
        rnVolume: 1,
      }),
      row({ id: '3', weightKg: '50', reps: 20, date: '2026-03-01', rn1Rm: 1 }),
    ]);

    const result = await service.getPersonalRecords({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    });

    expect(result.heaviestSet?.weight).toBe('999.00');
    expect(result.highestVolumeSet?.weight).toBe('10.00');
    expect(result.highestVolumeSet?.volume).toBe('500.00'); // 10 * 50
    expect(result.best1Rm?.weight).toBe('50.00');
  });

  describe('comparePersonalRecords', () => {
    function currentCandidates(): PrCandidateRow[] {
      return [
        row({
          id: '1',
          weightKg: '110',
          reps: 5,
          date: '2026-09-01',
          rnWeight: 1,
        }),
        row({
          id: '2',
          weightKg: '50',
          reps: 20,
          date: '2026-09-02',
          rnVolume: 1,
        }), // volume 1000
        row({
          id: '3',
          weightKg: '90',
          reps: 10,
          date: '2026-09-03',
          rn1Rm: 1,
        }), // 1RM 120
      ];
    }

    function previousCandidates(): PrCandidateRow[] {
      return [
        row({
          id: '4',
          weightKg: '100',
          reps: 5,
          date: '2026-08-01',
          rnWeight: 1,
        }),
        row({
          id: '5',
          weightKg: '40',
          reps: 20,
          date: '2026-08-02',
          rnVolume: 1,
        }), // volume 800
        row({ id: '6', weightKg: '90', reps: 5, date: '2026-08-03', rn1Rm: 1 }), // 1RM 105
      ];
    }

    function baseQuery() {
      return {
        userId: 'user-1',
        exerciseName: 'Bench Press',
        currentFrom: '2026-09-01',
        currentTo: '2026-09-30',
        previousFrom: '2026-08-01',
        previousTo: '2026-08-31',
      };
    }

    it('computes correct absolute and percentage deltas when both ranges have data (positive improvement)', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(previousCandidates());

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.current.hasData).toBe(true);
      expect(result.previous.hasData).toBe(true);

      expect(result.delta.heaviestSet).toEqual({
        absolute: '10.00',
        percentage: '10.00',
      });
      expect(result.delta.highestVolumeSet).toEqual({
        absolute: '200.00',
        percentage: '25.00',
      });
      expect(result.delta.best1Rm).toEqual({
        absolute: '15.00',
        percentage: '14.29',
      });
    });

    it('computes a negative delta when the metric declined', async () => {
      // Swap current/previous so every metric goes down.
      repository.findCandidates
        .mockResolvedValueOnce(previousCandidates())
        .mockResolvedValueOnce(currentCandidates());

      const result = await service.comparePersonalRecords(baseQuery());

      // previous (denominator) is 110 here, not 100, since current/previous
      // were swapped — percentage is not simply the negation of the
      // positive-direction test's percentage.
      expect(result.delta.heaviestSet).toEqual({
        absolute: '-10.00',
        percentage: '-9.09',
      });
    });

    it('returns a zero delta when both ranges have identical metrics', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(currentCandidates());

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.delta.heaviestSet).toEqual({
        absolute: '0.00',
        percentage: '0.00',
      });
    });

    it('returns null deltas (not zero) when the current range has no data', async () => {
      repository.findCandidates
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(previousCandidates());

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.current.hasData).toBe(false);
      expect(result.current.message).toBe(
        'No workout data found for this user and exercise.',
      );
      expect(result.previous.hasData).toBe(true);
      expect(result.delta.heaviestSet).toEqual({
        absolute: null,
        percentage: null,
      });
      expect(result.delta.highestVolumeSet).toEqual({
        absolute: null,
        percentage: null,
      });
      expect(result.delta.best1Rm).toEqual({
        absolute: null,
        percentage: null,
      });
    });

    it('returns null deltas (not zero) when the previous range has no data', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce([]);

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.current.hasData).toBe(true);
      expect(result.previous.hasData).toBe(false);
      expect(result.delta.heaviestSet).toEqual({
        absolute: null,
        percentage: null,
      });
    });

    it('returns null deltas when both ranges have no data', async () => {
      repository.findCandidates
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.current.hasData).toBe(false);
      expect(result.previous.hasData).toBe(false);
      expect(result.delta.heaviestSet).toEqual({
        absolute: null,
        percentage: null,
      });
      expect(result.delta.highestVolumeSet).toEqual({
        absolute: null,
        percentage: null,
      });
      expect(result.delta.best1Rm).toEqual({
        absolute: null,
        percentage: null,
      });
    });

    it('returns a null percentage (not Infinity/NaN) when the previous metric is exactly zero, while still computing the absolute delta', async () => {
      const zeroPrevious: PrCandidateRow[] = [
        row({
          id: '4',
          weightKg: '0',
          reps: 5,
          date: '2026-08-01',
          rnWeight: 1,
        }),
        row({
          id: '5',
          weightKg: '0',
          reps: 20,
          date: '2026-08-02',
          rnVolume: 1,
        }),
        row({ id: '6', weightKg: '0', reps: 5, date: '2026-08-03', rn1Rm: 1 }),
      ];
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(zeroPrevious);

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.delta.heaviestSet.absolute).toBe('110.00');
      expect(result.delta.heaviestSet.percentage).toBeNull();
    });

    it('defaults to kg output', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(previousCandidates());

      const result = await service.comparePersonalRecords(baseQuery());

      expect(result.unit).toBe('kg');
      expect(result.current.heaviestSet?.unit).toBe('kg');
    });

    it('converts range PRs and the absolute delta to the requested output unit', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(previousCandidates());

      const result = await service.comparePersonalRecords({
        ...baseQuery(),
        unit: 'lb',
      });

      expect(result.unit).toBe('lb');
      expect(result.current.heaviestSet?.unit).toBe('lb');
      // 10kg delta -> lb
      expect(Number(result.delta.heaviestSet.absolute)).toBeCloseTo(22.05, 1);
      // Percentage stays unit-independent regardless of display unit.
      expect(result.delta.heaviestSet.percentage).toBe('10.00');
    });

    it('queries the repository with correct, independently inclusive ranges', async () => {
      repository.findCandidates
        .mockResolvedValueOnce(currentCandidates())
        .mockResolvedValueOnce(previousCandidates());

      await service.comparePersonalRecords(baseQuery());

      expect(repository.findCandidates).toHaveBeenNthCalledWith(
        1,
        'user-1',
        'bench press',
        {
          from: new Date(Date.UTC(2026, 8, 1)),
          to: new Date(Date.UTC(2026, 8, 30)),
        },
      );
      expect(repository.findCandidates).toHaveBeenNthCalledWith(
        2,
        'user-1',
        'bench press',
        {
          from: new Date(Date.UTC(2026, 7, 1)),
          to: new Date(Date.UTC(2026, 7, 31)),
        },
      );
    });

    it('throws UnsupportedUnitError and never queries the repository for an unsupported unit', async () => {
      await expect(
        service.comparePersonalRecords({ ...baseQuery(), unit: 'oz' }),
      ).rejects.toThrow(UnsupportedUnitError);

      expect(repository.findCandidates).not.toHaveBeenCalled();
    });
  });
});
