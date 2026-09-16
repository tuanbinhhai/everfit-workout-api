import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'http';
import { createPinoHttpOptions } from './pino-http-options';
import { REQUEST_ID_HEADER } from './resolve-request-id';

function fakeConfigService(level: string): {
  config: ConfigService;
  get: jest.Mock;
} {
  const get = jest.fn().mockReturnValue(level);
  return { config: { get } as unknown as ConfigService, get };
}

describe('createPinoHttpOptions', () => {
  it('reads the log level from ConfigService', () => {
    const { config, get } = fakeConfigService('debug');
    const options = createPinoHttpOptions(config);

    expect(options.pinoHttp).toMatchObject({ level: 'debug' });
    expect(get).toHaveBeenCalledWith('logLevel', 'info');
  });

  it('genReqId reuses a client-supplied id and sets it on the response', () => {
    const { config } = fakeConfigService('info');
    const options = createPinoHttpOptions(config);
    const setHeader = jest.fn();
    const req = {
      headers: { [REQUEST_ID_HEADER]: 'client-id-1' },
    } as unknown as IncomingMessage;
    const res = { setHeader } as unknown as ServerResponse;

    const genReqId =
      options.pinoHttp && 'genReqId' in options.pinoHttp
        ? options.pinoHttp.genReqId
        : undefined;
    const id = genReqId?.(req, res);

    expect(id).toBe('client-id-1');
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'client-id-1');
  });

  it('serializers expose id/method/url and statusCode, never headers/body', () => {
    const { config } = fakeConfigService('info');
    const options = createPinoHttpOptions(config);
    const serializers =
      options.pinoHttp && 'serializers' in options.pinoHttp
        ? options.pinoHttp.serializers
        : undefined;

    const serializedReq = serializers?.req?.({
      id: 'req-id-1',
      method: 'POST',
      url: '/workouts',
      headers: { authorization: 'Bearer secret-token' },
    }) as { id: string; method: string; url: string } | undefined;
    const serializedRes = serializers?.res?.({ statusCode: 201 }) as
      { statusCode: number } | undefined;

    expect(serializedReq).toEqual({
      id: 'req-id-1',
      method: 'POST',
      url: '/workouts',
    });
    expect(serializedReq).not.toHaveProperty('headers');
    expect(serializedRes).toEqual({ statusCode: 201 });
  });
});
