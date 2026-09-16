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

interface PersonalRecordsBody {
  userId: string;
  exerciseName: string;
  unit: string;
  hasData: boolean;
  heaviestSet: PrRecordBody | null;
  highestVolumeSet: PrRecordBody | null;
  best1Rm: PrRecordBody | null;
  message?: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details: unknown[];
}

describe('GET /workouts/prs (e2e)', () => {
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

  function get(query: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value);
    }
    return request(httpServer).get(`/workouts/prs?${params.toString()}`);
  }

  it('returns PRs in kg by default', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-01',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    }).expect(200);
    const body = res.body as PersonalRecordsBody;

    expect(body.hasData).toBe(true);
    expect(body.unit).toBe('kg');
    expect(body.heaviestSet).toMatchObject({
      weight: '100.00',
      reps: 5,
      unit: 'kg',
    });
  });

  it('converts PRs to unit=lb', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-01',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 100, unit: 'kg' }],
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      unit: 'lb',
    }).expect(200);
    const body = res.body as PersonalRecordsBody;

    expect(body.unit).toBe('lb');
    expect(body.heaviestSet?.weight).toBe('220.46');
  });

  it('ranks correctly across mixed kg/lb historical data', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-01',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 220, unit: 'lb' }], // ~99.79kg
      },
      {
        userId: 'user-1',
        date: '2026-09-02',
        exerciseName: 'Bench Press',
        sets: [{ reps: 5, weight: 90, unit: 'kg' }], // 90kg, less than the lb set
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    }).expect(200);
    const body = res.body as PersonalRecordsBody;

    // The lb-logged set is canonically heavier despite the "rounder" kg number.
    expect(Number(body.heaviestSet?.weight)).toBeCloseTo(99.79, 1);
  });

  it('reports distinct winners with correct achievement dates for weight, volume, and 1RM', async () => {
    await seed([
      {
        userId: 'user-1',
        date: '2026-09-01',
        exerciseName: 'Bench Press',
        sets: [{ reps: 1, weight: 300, unit: 'kg' }], // heaviest
      },
      {
        userId: 'user-1',
        date: '2026-09-02',
        exerciseName: 'Bench Press',
        sets: [{ reps: 30, weight: 60, unit: 'kg' }], // highest volume
      },
      {
        userId: 'user-1',
        date: '2026-09-03',
        exerciseName: 'Bench Press',
        sets: [{ reps: 4, weight: 280, unit: 'kg' }], // best 1RM
      },
    ]);

    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
    }).expect(200);
    const body = res.body as PersonalRecordsBody;

    expect(body.heaviestSet).toMatchObject({
      weight: '300.00',
      date: '2026-09-01',
    });
    expect(body.highestVolumeSet).toMatchObject({
      weight: '60.00',
      volume: '1800.00',
      date: '2026-09-02',
    });
    expect(body.best1Rm?.date).toBe('2026-09-03');
    expect(Number(body.best1Rm?.estimated1Rm)).toBeGreaterThan(310); // beats set A's 1RM
  });

  it('returns hasData:false with a message when there is no data, not an error', async () => {
    const res = await get({
      userId: 'user-with-no-history',
      exerciseName: 'Bench Press',
    }).expect(200);
    const body = res.body as PersonalRecordsBody;

    expect(body.hasData).toBe(false);
    expect(body.heaviestSet).toBeNull();
    expect(body.highestVolumeSet).toBeNull();
    expect(body.best1Rm).toBeNull();
    expect(body.message).toBe(
      'No workout data found for this user and exercise.',
    );
  });

  it('rejects a missing userId', async () => {
    const res = await get({ exerciseName: 'Bench Press' }).expect(400);
    const body = res.body as ErrorBody;
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
  });

  it('rejects a missing exerciseName', async () => {
    const res = await get({ userId: 'user-1' }).expect(400);
    const body = res.body as ErrorBody;
    expect(body.statusCode).toBe(400);
  });

  it('rejects an unsupported unit with a structured error', async () => {
    const res = await get({
      userId: 'user-1',
      exerciseName: 'Bench Press',
      unit: 'oz',
    }).expect(400);
    const body = res.body as ErrorBody;

    expect(body.statusCode).toBe(400);
    expect(body.message).toContain('oz');
    expect(Array.isArray(body.details)).toBe(true);
  });
});
