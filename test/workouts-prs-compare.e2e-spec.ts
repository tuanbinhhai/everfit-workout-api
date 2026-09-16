import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';

interface PrRecordBody {
  weight: string;
  reps: number;
  date: string;
  unit: string;
  volume?: string;
  estimated1Rm?: string;
}

interface PrRangeBody {
  from: string;
  to: string;
  hasData: boolean;
  heaviestSet: PrRecordBody | null;
  highestVolumeSet: PrRecordBody | null;
  best1Rm: PrRecordBody | null;
  message?: string;
}

interface DeltaBody {
  absolute: string | null;
  percentage: string | null;
}

interface CompareBody {
  userId: string;
  exerciseName: string;
  unit: string;
  current: PrRangeBody;
  previous: PrRangeBody;
  delta: {
    heaviestSet: DeltaBody;
    highestVolumeSet: DeltaBody;
    best1Rm: DeltaBody;
  };
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details: unknown[];
}

describe('GET /workouts/prs/compare (e2e)', () => {
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

  async function seed(entries: unknown[]) {
    await request(httpServer).post('/workouts').send({ entries }).expect(201);
  }

  const defaultRanges = {
    currentFrom: '2026-09-01',
    currentTo: '2026-09-30',
    previousFrom: '2026-08-01',
    previousTo: '2026-08-31',
  };

  function get(query: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value);
    }
    return request(httpServer).get(
      `/workouts/prs/compare?${params.toString()}`,
    );
  }

  it('returns a valid comparison with a positive delta in kg', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 110, unit: 'kg' }],
      },
      {
        userId: 'user-1',
        date: '2026-08-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.unit).toBe('kg');
    expect(body.current.hasData).toBe(true);
    expect(body.previous.hasData).toBe(true);
    expect(body.current.heaviestSet?.weight).toBe('110.00');
    expect(body.previous.heaviestSet?.weight).toBe('100.00');
    expect(body.delta.heaviestSet).toEqual({
      absolute: '10.00',
      percentage: '10.00',
    });
  });

  it('converts range PRs and delta to unit=lb', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 110, unit: 'kg' }],
      },
      {
        userId: 'user-1',
        date: '2026-08-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
      unit: 'lb',
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.unit).toBe('lb');
    expect(body.current.heaviestSet?.unit).toBe('lb');
    expect(Number(body.delta.heaviestSet.absolute)).toBeCloseTo(22.05, 1);
    expect(body.delta.heaviestSet.percentage).toBe('10.00'); // unit-independent
  });

  it('reports a negative delta when the metric declined', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 90, unit: 'kg' }],
      },
      {
        userId: 'user-1',
        date: '2026-08-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.delta.heaviestSet).toEqual({
      absolute: '-10.00',
      percentage: '-10.00',
    });
  });

  it('returns null deltas (not an error) when the current range is empty', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-08-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.current.hasData).toBe(false);
    expect(body.current.message).toBe(
      'No workout data found for this user and exercise.',
    );
    expect(body.previous.hasData).toBe(true);
    expect(body.delta.heaviestSet).toEqual({
      absolute: null,
      percentage: null,
    });
  });

  it('returns null deltas when the previous range is empty', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-05',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.current.hasData).toBe(true);
    expect(body.previous.hasData).toBe(false);
    expect(body.delta.heaviestSet).toEqual({
      absolute: null,
      percentage: null,
    });
  });

  it('returns a 200 with both ranges hasData:false when neither has data', async () => {
    const res = await get({
      userId: 'user-with-no-history',
      exerciseName: 'Bench Press',
      ...defaultRanges,
    }).expect(200);
    const body = res.body as CompareBody;

    expect(body.current.hasData).toBe(false);
    expect(body.previous.hasData).toBe(false);
    expect(body.delta.heaviestSet).toEqual({
      absolute: null,
      percentage: null,
    });
    expect(body.delta.highestVolumeSet).toEqual({
      absolute: null,
      percentage: null,
    });
    expect(body.delta.best1Rm).toEqual({ absolute: null, percentage: null });
  });

  it('rejects an invalid current range (currentFrom > currentTo)', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      currentFrom: '2026-09-30',
      currentTo: '2026-09-01',
      previousFrom: '2026-08-01',
      previousTo: '2026-08-31',
    }).expect(400);
    expect((res.body as ErrorBody).statusCode).toBe(400);
  });

  it('rejects an invalid previous range (previousFrom > previousTo)', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      currentFrom: '2026-09-01',
      currentTo: '2026-09-30',
      previousFrom: '2026-08-31',
      previousTo: '2026-08-01',
    }).expect(400);
    expect((res.body as ErrorBody).statusCode).toBe(400);
  });

  it('rejects an impossible calendar date', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      currentFrom: '2026-02-30',
      currentTo: '2026-09-30',
      previousFrom: '2026-08-01',
      previousTo: '2026-08-31',
    }).expect(400);
    expect((res.body as ErrorBody).statusCode).toBe(400);
  });

  it('rejects missing required params', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    }).expect(400);
    const body = res.body as ErrorBody;
    expect(body.statusCode).toBe(400);
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported unit with a structured error', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      ...defaultRanges,
      unit: 'oz',
    }).expect(400);
    const body = res.body as ErrorBody;

    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toContain('oz');
  });
});
