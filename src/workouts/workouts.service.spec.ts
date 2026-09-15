import { UnitConversionService } from '../unit-conversion/unit-conversion.service';
import { UnsupportedUnitError } from '../unit-conversion/unsupported-unit.error';
import { BulkCreateWorkoutDto } from './dto/bulk-create-workout.dto';
import {
  CreatedWorkoutEntry,
  WorkoutEntryInput,
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
  };
  let unitConversion: UnitConversionService;

  beforeEach(() => {
    repository = {
      createMany: jest
        .fn<Promise<CreatedWorkoutEntry[]>, [WorkoutEntryInput[]]>()
        .mockResolvedValue([]),
    };
    unitConversion = new UnitConversionService();
    service = new WorkoutsService(
      repository as unknown as WorkoutsRepository,
      unitConversion,
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
});
