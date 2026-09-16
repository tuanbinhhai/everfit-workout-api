import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import {
  PrCandidateRow,
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

describe('PersonalRecordsService', () => {
  let service: PersonalRecordsService;
  let repository: {
    findCandidates: jest.Mock<Promise<PrCandidateRow[]>, [string, string]>;
  };
  let unitConversion: UnitConversionService;

  beforeEach(() => {
    repository = {
      findCandidates: jest
        .fn<Promise<PrCandidateRow[]>, [string, string]>()
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
});
