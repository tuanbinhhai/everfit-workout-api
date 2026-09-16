import { ConfigService } from '@nestjs/config';
import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import {
  CreatedWorkoutEntry,
  WorkoutEntryInput,
  WorkoutHistoryFilter,
  WorkoutHistoryPage,
  WorkoutsRepository,
} from './workouts.repository';
import { WorkoutsService } from './workouts.service';

function buildDto(
  entries: BulkCreateWorkoutDto['entries'],
): BulkCreateWorkoutDto {
  return { entries };
}

describe('WorkoutsService', () => {
  let service: WorkoutsService;
  let repository: {
    createMany: jest.Mock<
      Promise<CreatedWorkoutEntry[]>,
      [WorkoutEntryInput[]]
    >;
    findHistory: jest.Mock<Promise<WorkoutHistoryPage>, [WorkoutHistoryFilter]>;
  };
  let unitConversion: UnitConversionService;
  let config: ConfigService;

  beforeEach(() => {
    repository = {
      createMany: jest
        .fn<Promise<CreatedWorkoutEntry[]>, [WorkoutEntryInput[]]>()
        .mockResolvedValue([]),
      findHistory: jest
        .fn<Promise<WorkoutHistoryPage>, [WorkoutHistoryFilter]>()
        .mockResolvedValue({ entries: [], hasMore: false }),
    };
    unitConversion = new UnitConversionService();
    config = { get: jest.fn().mockReturnValue(20) } as unknown as ConfigService;
    service = new WorkoutsService(
      repository as unknown as WorkoutsRepository,
      unitConversion,
      config,
    );
  });

  function passedEntries(): WorkoutEntryInput[] {
    return repository.createMany.mock.calls[0][0];
  }

  it('preserves the original weight and unit for a kg set', async () => {
    await service.logWorkouts(
      buildDto([
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Bench Press',
          sets: [{ reps: 5, weight: 100, unit: 'kg' }],
        },
      ]),
    );

    expect(passedEntries()[0].sets[0]).toMatchObject({
      weight: '100',
      unit: 'kg',
      weightKg: '100',
    });
  });

  it('normalizes an lb set to canonical kg while preserving the original weight/unit', async () => {
    await service.logWorkouts(
      buildDto([
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Squat',
          sets: [{ reps: 5, weight: 220, unit: 'lb' }],
        },
      ]),
    );

    const set = passedEntries()[0].sets[0];
    expect(set.weight).toBe('220');
    expect(set.unit).toBe('lb');
    expect(Number(set.weightKg)).toBeCloseTo(99.7903214, 6);
  });

  it('assigns deterministic zero-based setIndex across multiple sets', async () => {
    await service.logWorkouts(
      buildDto([
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Bench Press',
          sets: [
            { reps: 5, weight: 100, unit: 'kg' },
            { reps: 5, weight: 105, unit: 'kg' },
            { reps: 3, weight: 110, unit: 'kg' },
          ],
        },
      ]),
    );

    expect(passedEntries()[0].sets.map((s) => s.setIndex)).toEqual([0, 1, 2]);
  });

  it('delegates a complete normalized batch for multiple workout entries', async () => {
    await service.logWorkouts(
      buildDto([
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Bench Press',
          sets: [{ reps: 5, weight: 100, unit: 'kg' }],
        },
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Squat',
          sets: [{ reps: 5, weight: 150, unit: 'kg' }],
        },
      ]),
    );

    const entries = passedEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].exerciseName).toBe('Bench Press');
    expect(entries[1].exerciseName).toBe('Squat');
  });

  it('computes the normalized exercise name for storage while preserving the original', async () => {
    await service.logWorkouts(
      buildDto([
        {
          userId: 'user-1',
          date: '2026-09-01',
          exerciseName: 'Bench Press',
          sets: [{ reps: 5, weight: 100, unit: 'kg' }],
        },
      ]),
    );

    const entry = passedEntries()[0];
    expect(entry.exerciseName).toBe('Bench Press');
    expect(entry.exerciseNameNormalized).toBe('bench press');
  });

  it('throws UnsupportedUnitError and never calls the repository for an unsupported unit', async () => {
    await expect(
      service.logWorkouts(
        buildDto([
          {
            userId: 'user-1',
            date: '2026-09-01',
            exerciseName: 'Bench Press',
            sets: [{ reps: 5, weight: 100, unit: 'oz' }],
          },
        ]),
      ),
    ).rejects.toThrow(UnsupportedUnitError);

    expect(repository.createMany).not.toHaveBeenCalled();
  });

  it('propagates unexpected repository errors rather than swallowing them', async () => {
    repository.createMany.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.logWorkouts(
        buildDto([
          {
            userId: 'user-1',
            date: '2026-09-01',
            exerciseName: 'Bench Press',
            sets: [{ reps: 5, weight: 100, unit: 'kg' }],
          },
        ]),
      ),
    ).rejects.toThrow('connection lost');
  });

  describe('getHistory', () => {
    function fakeEntry(
      overrides: Partial<CreatedWorkoutEntry> = {},
    ): CreatedWorkoutEntry {
      return {
        id: 1n,
        userId: 'user-1',
        exerciseName: 'Bench Press',
        date: new Date(Date.UTC(2026, 8, 1)),
        sets: [
          {
            id: 10n,
            setIndex: 0,
            reps: 5,
            weight: '100',
            unit: 'kg',
            weightKg: '100',
          },
        ],
        ...overrides,
      };
    }

    it('passes the correct filters through to the repository', async () => {
      await service.getHistory({
        userId: 'user-1',
        exerciseName: '  Bench   Press ',
        from: '2026-09-01',
        to: '2026-09-30',
        muscleGroup: 'chest',
        cursor: undefined,
        limit: 10,
      });

      expect(repository.findHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          exerciseNameSubstring: 'bench press',
          muscleGroup: 'chest',
          from: new Date(Date.UTC(2026, 8, 1)),
          to: new Date(Date.UTC(2026, 8, 30)),
          limit: 10,
        }),
      );
    });

    it('defaults the output unit to kg', async () => {
      repository.findHistory.mockResolvedValue({
        entries: [fakeEntry()],
        hasMore: false,
      });

      const result = await service.getHistory({ userId: 'user-1' });

      expect(result.data[0].sets[0].unit).toBe('kg');
      expect(result.data[0].sets[0].convertedWeight).toBe('100.00');
    });

    it('converts to the requested output unit', async () => {
      repository.findHistory.mockResolvedValue({
        entries: [fakeEntry()],
        hasMore: false,
      });

      const result = await service.getHistory({ userId: 'user-1', unit: 'lb' });

      expect(result.data[0].sets[0].unit).toBe('lb');
      // Rounded to 2dp at the display boundary (docs/CLARIFICATIONS.md #11).
      expect(result.data[0].sets[0].convertedWeight).toBe('220.46');
    });

    it('preserves the original weight and unit regardless of the requested output unit', async () => {
      repository.findHistory.mockResolvedValue({
        entries: [
          fakeEntry({
            sets: [
              {
                id: 10n,
                setIndex: 0,
                reps: 5,
                weight: '220',
                unit: 'lb',
                weightKg: '99.7903',
              },
            ],
          }),
        ],
        hasMore: false,
      });

      const result = await service.getHistory({ userId: 'user-1', unit: 'kg' });

      expect(result.data[0].sets[0].originalWeight).toBe('220');
      expect(result.data[0].sets[0].originalUnit).toBe('lb');
      expect(result.data[0].sets[0].convertedWeight).toBe('99.79');
    });

    it('always converts from canonical weightKg, never re-deriving from the original value', async () => {
      // A deliberately inconsistent original/weightKg pair (not a realistic
      // conversion of one another) isolates exactly which one the mapping
      // logic actually reads from — if it read the original instead, this
      // would assert the wrong, obviously-distinguishable value.
      repository.findHistory.mockResolvedValue({
        entries: [
          fakeEntry({
            sets: [
              {
                id: 10n,
                setIndex: 0,
                reps: 5,
                weight: '999',
                unit: 'kg',
                weightKg: '50',
              },
            ],
          }),
        ],
        hasMore: false,
      });

      const result = await service.getHistory({ userId: 'user-1', unit: 'kg' });

      expect(result.data[0].sets[0].originalWeight).toBe('999');
      expect(result.data[0].sets[0].convertedWeight).toBe('50.00');
    });

    it('generates nextCursor from the last returned record when hasMore is true', async () => {
      repository.findHistory.mockResolvedValue({
        entries: [
          fakeEntry({ id: 5n, date: new Date(Date.UTC(2026, 8, 2)) }),
          fakeEntry({ id: 3n, date: new Date(Date.UTC(2026, 8, 1)) }),
        ],
        hasMore: true,
      });

      const result = await service.getHistory({ userId: 'user-1' });

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).not.toBeNull();

      const decoded = JSON.parse(
        Buffer.from(result.pagination.nextCursor ?? '', 'base64url').toString(
          'utf8',
        ),
      ) as { date: string; id: string };
      expect(decoded).toEqual({ date: '2026-09-01', id: '3' });
    });

    it('returns a null nextCursor when hasMore is false, even with results', async () => {
      repository.findHistory.mockResolvedValue({
        entries: [fakeEntry()],
        hasMore: false,
      });

      const result = await service.getHistory({ userId: 'user-1' });

      expect(result.pagination.hasMore).toBe(false);
      expect(result.pagination.nextCursor).toBeNull();
    });

    it('returns an empty-result shape with a message and no error', async () => {
      repository.findHistory.mockResolvedValue({ entries: [], hasMore: false });

      const result = await service.getHistory({ userId: 'user-1' });

      expect(result.data).toEqual([]);
      expect(result.pagination).toEqual({ nextCursor: null, hasMore: false });
      expect(result.message).toBe(
        'No workout entries found for the specified criteria.',
      );
    });

    it('throws UnsupportedUnitError and never queries the repository for an unsupported unit', async () => {
      await expect(
        service.getHistory({ userId: 'user-1', unit: 'oz' }),
      ).rejects.toThrow(UnsupportedUnitError);

      expect(repository.findHistory).not.toHaveBeenCalled();
    });

    it('throws InvalidCursorError and never queries the repository for a malformed cursor', async () => {
      await expect(
        service.getHistory({ userId: 'user-1', cursor: 'not-a-valid-cursor' }),
      ).rejects.toThrow('Invalid pagination cursor');

      expect(repository.findHistory).not.toHaveBeenCalled();
    });
  });
});
