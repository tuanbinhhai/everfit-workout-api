import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

interface WorkoutSetBody {
  id: string;
  setIndex: number;
  reps: number;
  weight: string;
  unit: string;
  weightKg: string;
}

interface WorkoutEntryBody {
  id: string;
  userId: string;
  exerciseName: string;
  date: string;
  sets: WorkoutSetBody[];
}

interface WorkoutsSuccessBody {
  entries: WorkoutEntryBody[];
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details: unknown[];
  timestamp: string;
  path: string;
}

describe('POST /workouts (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await prisma.workoutSet.deleteMany();
    await prisma.workoutEntry.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  function validEntry(overrides: Record<string, unknown> = {}) {
    return {
      userId: 'user-1',
      date: '2026-09-01',
      exerciseName: 'Bench Press',
      sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      ...overrides,
    };
  }

  function post(entries: unknown[]) {
    return request(httpServer).post('/workouts').send({ entries });
  }

  describe('happy paths', () => {
    it('logs one exercise with one set', async () => {
      const res = await post([validEntry()]).expect(201);
      const body = res.body as WorkoutsSuccessBody;

      expect(body.entries).toHaveLength(1);
      const entry = body.entries[0];
      expect(entry.userId).toBe('user-1');
      expect(entry.date).toBe('2026-09-01');
      expect(entry.sets).toHaveLength(1);
      expect(entry.sets[0]).toMatchObject({
        reps: 5,
        weight: '100',
        unit: 'kg',
        weightKg: '100',
      });
    });

    it('logs one exercise with multiple sets, preserving order', async () => {
      const res = await post([
        validEntry({
          sets: [
            { reps: 5, weight: 100, unit: 'kg' },
            { reps: 5, weight: 105, unit: 'kg' },
            { reps: 3, weight: 110, unit: 'kg' },
          ],
        }),
      ]).expect(201);
      const body = res.body as WorkoutsSuccessBody;

      const sets = body.entries[0].sets;
      expect(sets.map((s) => s.setIndex)).toEqual([0, 1, 2]);
      expect(sets.map((s) => s.weight)).toEqual(['100', '105', '110']);
    });

    it('logs multiple exercises in one bulk request', async () => {
      const res = await post([
        validEntry({ exerciseName: 'Bench Press' }),
        validEntry({ exerciseName: 'Squat' }),
      ]).expect(201);
      const body = res.body as WorkoutsSuccessBody;

      expect(body.entries).toHaveLength(2);
      expect(await prisma.workoutEntry.count()).toBe(2);
    });

    it('accepts kg and normalizes to the same value', async () => {
      const res = await post([
        validEntry({ sets: [{ reps: 5, weight: 100, unit: 'kg' }] }),
      ]).expect(201);
      const body = res.body as WorkoutsSuccessBody;

      expect(body.entries[0].sets[0].weightKg).toBe('100');
    });

    it('accepts lb and normalizes to kg', async () => {
      const res = await post([
        validEntry({ sets: [{ reps: 5, weight: 220, unit: 'lb' }] }),
      ]).expect(201);
      const body = res.body as WorkoutsSuccessBody;

      expect(body.entries[0].sets[0].unit).toBe('lb');
      expect(Number(body.entries[0].sets[0].weightKg)).toBeCloseTo(99.7903, 4);
    });
  });

  describe('validation/error paths', () => {
    async function expectRejected(entries: unknown[]): Promise<ErrorBody> {
      const res = await post(entries).expect(400);
      const body = res.body as ErrorBody;

      expect(body).toMatchObject({ statusCode: 400, error: 'Bad Request' });
      expect(Array.isArray(body.details)).toBe(true);
      expect(await prisma.workoutEntry.count()).toBe(0);
      return body;
    }

    it('rejects a missing userId', async () => {
      const entry = validEntry();
      delete (entry as Record<string, unknown>).userId;
      await expectRejected([entry]);
    });

    it('rejects a null date', async () => {
      await expectRejected([validEntry({ date: null })]);
    });

    it('rejects a malformed date', async () => {
      await expectRejected([validEntry({ date: '15-09-2026' })]);
    });

    it('rejects an ISO datetime instead of a plain date', async () => {
      await expectRejected([validEntry({ date: '2026-09-15T10:00:00Z' })]);
    });

    it('rejects an impossible calendar date', async () => {
      await expectRejected([validEntry({ date: '2026-02-30' })]);
    });

    it('rejects an empty exerciseName', async () => {
      await expectRejected([validEntry({ exerciseName: '' })]);
    });

    it('rejects a whitespace-only exerciseName', async () => {
      await expectRejected([validEntry({ exerciseName: '   ' })]);
    });

    it('rejects an empty sets array', async () => {
      await expectRejected([validEntry({ sets: [] })]);
    });

    it('rejects reps = 0', async () => {
      await expectRejected([
        validEntry({ sets: [{ reps: 0, weight: 100, unit: 'kg' }] }),
      ]);
    });

    it('rejects negative reps', async () => {
      await expectRejected([
        validEntry({ sets: [{ reps: -1, weight: 100, unit: 'kg' }] }),
      ]);
    });

    it('rejects non-integer reps', async () => {
      await expectRejected([
        validEntry({ sets: [{ reps: 5.5, weight: 100, unit: 'kg' }] }),
      ]);
    });

    it('rejects negative weight', async () => {
      await expectRejected([
        validEntry({ sets: [{ reps: 5, weight: -10, unit: 'kg' }] }),
      ]);
    });

    it('rejects an unsupported unit', async () => {
      const body = await expectRejected([
        validEntry({ sets: [{ reps: 5, weight: 100, unit: 'oz' }] }),
      ]);
      expect(body.statusCode).toBe(400);
    });

    it('rejects an empty entries array', async () => {
      const res = await post([]).expect(400);
      const body = res.body as ErrorBody;
      expect(body.statusCode).toBe(400);
    });

    it('rejects an oversized bulk request', async () => {
      const entries = Array.from({ length: 101 }, () => validEntry());
      await expectRejected(entries);
    });

    it('rejects the whole bulk request, persisting nothing, when only one of several entries is invalid', async () => {
      await expectRejected([
        validEntry({ exerciseName: 'Bench Press' }),
        validEntry({
          exerciseName: 'Squat',
          sets: [{ reps: 0, weight: 100, unit: 'kg' }],
        }),
      ]);
    });
  });

  describe('concurrency', () => {
    it('persists two concurrent requests for the same user/exercise independently', async () => {
      const [resA, resB] = await Promise.all([
        post([validEntry({ sets: [{ reps: 5, weight: 100, unit: 'kg' }] })]),
        post([validEntry({ sets: [{ reps: 5, weight: 105, unit: 'kg' }] })]),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      const bodyA = resA.body as WorkoutsSuccessBody;
      const bodyB = resB.body as WorkoutsSuccessBody;
      expect(bodyA.entries[0].id).not.toBe(bodyB.entries[0].id);
      expect(await prisma.workoutEntry.count()).toBe(2);
    });
  });
});
