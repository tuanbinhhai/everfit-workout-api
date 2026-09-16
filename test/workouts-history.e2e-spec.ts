import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

interface HistorySetBody {
  id: string;
  setIndex: number;
  reps: number;
  originalWeight: string;
  originalUnit: string;
  convertedWeight: string;
  unit: string;
}

interface HistoryEntryBody {
  id: string;
  userId: string;
  exerciseName: string;
  date: string;
  sets: HistorySetBody[];
}

interface HistoryBody {
  data: HistoryEntryBody[];
  pagination: { nextCursor: string | null; hasMore: boolean };
  message?: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details: unknown[];
}

describe('GET /workouts (e2e)', () => {
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

  function seedEntry(overrides: Record<string, unknown> = {}) {
    return {
      userId: 'user-1',
      date: '2026-09-01',
      exerciseName: 'Bench Press',
      sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      ...overrides,
    };
  }

  async function seed(entries: unknown[]) {
    await request(httpServer).post('/workouts').send({ entries }).expect(201);
  }

  function get(query: Record<string, string | number | undefined>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return request(httpServer).get(`/workouts?${params.toString()}`);
  }

  describe('happy paths', () => {
    it('returns workout history for a user', async () => {
      await seed([seedEntry()]);

      const res = await get({ userId: 'user-1' }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].exerciseName).toBe('Bench Press');
      expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
    });

    it('defaults to kg output', async () => {
      await seed([seedEntry({ sets: [{ reps: 5, weight: 100, unit: 'kg' }] })]);

      const res = await get({ userId: 'user-1' }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data[0].sets[0].unit).toBe('kg');
      expect(body.data[0].sets[0].convertedWeight).toBe('100.00');
    });

    it('converts to unit=lb', async () => {
      await seed([seedEntry({ sets: [{ reps: 5, weight: 100, unit: 'kg' }] })]);

      const res = await get({ userId: 'user-1', unit: 'lb' }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data[0].sets[0].unit).toBe('lb');
      // Rounded to 2dp at the display boundary (docs/CLARIFICATIONS.md #11).
      expect(body.data[0].sets[0].convertedWeight).toBe('220.46');
    });

    it('matches a partial exercise name substring', async () => {
      await seed([
        seedEntry({ exerciseName: 'Bench Press' }),
        seedEntry({ exerciseName: 'Incline Bench Press' }),
        seedEntry({ exerciseName: 'Squat' }),
      ]);

      const res = await get({ userId: 'user-1', exerciseName: 'bench' }).expect(
        200,
      );
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(2);
    });

    it('matches case-insensitively', async () => {
      await seed([seedEntry({ exerciseName: 'Bench Press' })]);

      const res = await get({ userId: 'user-1', exerciseName: 'BENCH' }).expect(
        200,
      );
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
    });

    it('filters with `from` only', async () => {
      await seed([
        seedEntry({ date: '2026-09-01' }),
        seedEntry({ date: '2026-09-10' }),
      ]);

      const res = await get({ userId: 'user-1', from: '2026-09-05' }).expect(
        200,
      );
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].date).toBe('2026-09-10');
    });

    it('filters with `to` only', async () => {
      await seed([
        seedEntry({ date: '2026-09-01' }),
        seedEntry({ date: '2026-09-10' }),
      ]);

      const res = await get({ userId: 'user-1', to: '2026-09-05' }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].date).toBe('2026-09-01');
    });

    it('filters with `from` and `to` together', async () => {
      await seed([
        seedEntry({ date: '2026-09-01' }),
        seedEntry({ date: '2026-09-10' }),
        seedEntry({ date: '2026-09-20' }),
      ]);

      const res = await get({
        userId: 'user-1',
        from: '2026-09-05',
        to: '2026-09-15',
      }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].date).toBe('2026-09-10');
    });

    it('filters by muscleGroup', async () => {
      await seed([
        seedEntry({ exerciseName: 'Bench Press' }),
        seedEntry({ exerciseName: 'Squat' }),
      ]);

      const res = await get({ userId: 'user-1', muscleGroup: 'chest' }).expect(
        200,
      );
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].exerciseName).toBe('Bench Press');
    });

    it('composes exerciseName, date range, and muscleGroup filters together', async () => {
      await seed([
        seedEntry({ exerciseName: 'Bench Press', date: '2026-09-15' }),
        seedEntry({ exerciseName: 'Incline Bench Press', date: '2026-08-01' }),
        seedEntry({ exerciseName: 'Squat', date: '2026-09-15' }),
      ]);

      const res = await get({
        userId: 'user-1',
        exerciseName: 'bench',
        muscleGroup: 'chest',
        from: '2026-09-01',
        to: '2026-09-30',
      }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data).toHaveLength(1);
      expect(body.data[0].exerciseName).toBe('Bench Press');
    });
  });

  describe('pagination', () => {
    it('pages through results with no duplicates or skips using nextCursor', async () => {
      const entries = Array.from({ length: 12 }, (_, i) =>
        seedEntry({
          exerciseName: `Exercise ${i}`,
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
        }),
      );
      await seed(entries);

      const firstPage = await get({ userId: 'user-1', limit: 5 }).expect(200);
      const firstBody = firstPage.body as HistoryBody;
      expect(firstBody.data).toHaveLength(5);
      expect(firstBody.pagination.hasMore).toBe(true);
      expect(firstBody.pagination.nextCursor).not.toBeNull();

      const secondPage = await get({
        userId: 'user-1',
        limit: 5,
        cursor: firstBody.pagination.nextCursor ?? undefined,
      }).expect(200);
      const secondBody = secondPage.body as HistoryBody;
      expect(secondBody.data).toHaveLength(5);
      expect(secondBody.pagination.hasMore).toBe(true);

      const thirdPage = await get({
        userId: 'user-1',
        limit: 5,
        cursor: secondBody.pagination.nextCursor ?? undefined,
      }).expect(200);
      const thirdBody = thirdPage.body as HistoryBody;
      expect(thirdBody.data).toHaveLength(2);
      expect(thirdBody.pagination.hasMore).toBe(false);
      expect(thirdBody.pagination.nextCursor).toBeNull();

      const allIds = [
        ...firstBody.data.map((e) => e.id),
        ...secondBody.data.map((e) => e.id),
        ...thirdBody.data.map((e) => e.id),
      ];
      expect(new Set(allIds).size).toBe(12);
    });
  });

  describe('validation', () => {
    it('rejects a missing userId', async () => {
      const res = await get({}).expect(400);
      const body = res.body as ErrorBody;
      expect(body.statusCode).toBe(400);
    });

    it('rejects an invalid `from`', async () => {
      const res = await get({ userId: 'user-1', from: '2026-02-30' }).expect(
        400,
      );
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects an invalid `to`', async () => {
      const res = await get({ userId: 'user-1', to: 'not-a-date' }).expect(400);
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects from > to', async () => {
      const res = await get({
        userId: 'user-1',
        from: '2026-09-20',
        to: '2026-09-01',
      }).expect(400);
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects an invalid limit', async () => {
      const res = await get({ userId: 'user-1', limit: 0 }).expect(400);
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects limit > MAX_PAGE_SIZE', async () => {
      const res = await get({ userId: 'user-1', limit: 101 }).expect(400);
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects an unsupported unit', async () => {
      const res = await get({ userId: 'user-1', unit: 'oz' }).expect(400);
      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('rejects a malformed cursor', async () => {
      const res = await get({
        userId: 'user-1',
        cursor: 'not-a-valid-cursor!!!',
      }).expect(400);
      const body = res.body as ErrorBody;
      expect(body.statusCode).toBe(400);
      expect(body.message).toBe('Invalid pagination cursor');
    });
  });

  describe('empty results', () => {
    it('returns 200 with an empty data array and a message, not an error', async () => {
      const res = await get({ userId: 'user-with-no-history' }).expect(200);
      const body = res.body as HistoryBody;

      expect(body.data).toEqual([]);
      expect(body.pagination).toEqual({ nextCursor: null, hasMore: false });
      expect(body.message).toBe(
        'No workout entries found for the specified criteria.',
      );
    });
  });
});
