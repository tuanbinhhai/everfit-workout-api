import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { REQUEST_ID_HEADER } from '../src/common/logging/resolve-request-id';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) returns ok status', () => {
    return request(httpServer)
      .get('/health')
      .expect(200)
      .expect({ status: 'ok' });
  });

  it('generates and returns a request id when the client supplies none', async () => {
    const res = await request(httpServer).get('/health').expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).toEqual(expect.any(String));
    expect(res.headers[REQUEST_ID_HEADER].length).toBeGreaterThan(0);
  });

  it('reuses a client-supplied request id instead of generating a new one', async () => {
    const res = await request(httpServer)
      .get('/health')
      .set(REQUEST_ID_HEADER, 'client-supplied-trace-id')
      .expect(200);
    expect(res.headers[REQUEST_ID_HEADER]).toBe('client-supplied-trace-id');
  });
});
