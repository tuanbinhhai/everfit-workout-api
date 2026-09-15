import {
  ArgumentsHost,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UnsupportedUnitError } from '../../unit-conversion/unsupported-unit.error';
import {
  GlobalExceptionFilter,
  StructuredErrorBody,
} from './global-exception.filter';

function createMockHost(url = '/workouts') {
  const json = jest.fn<void, [StructuredErrorBody]>();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status } as unknown as Response;
  const request = { method: 'POST', url } as Request;

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
  });

  it('maps UnsupportedUnitError to a structured 400 response', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new UnsupportedUnitError('oz'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Unsupported weight unit: "oz"',
        details: [{ field: 'unit', issue: 'Unsupported weight unit: "oz"' }],
        path: '/workouts',
      }),
    );
  });

  it('passes through pre-structured validation details from a BadRequestException', () => {
    const { host, status, json } = createMockHost();
    const details = [
      { field: 'entries.0.sets.0.reps', issue: 'reps must not be less than 1' },
    ];

    filter.catch(
      new BadRequestException({ message: 'Validation failed', details }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
        details,
      }),
    );
  });

  it('maps a plain HttpException using its own status and message', () => {
    const { host, status, json } = createMockHost();

    filter.catch(new NotFoundException('Workout not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        message: 'Workout not found',
      }),
    );
  });

  it('maps an unexpected error to a generic 500 without leaking internal details', () => {
    const { host, status, json } = createMockHost();

    filter.catch(
      new Error('connection string contains a secret password'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).not.toContain('secret password');
    expect(body.message).not.toContain('connection string');
  });

  it('includes an ISO timestamp and the request path', () => {
    const { host, json } = createMockHost('/workouts/prs');

    filter.catch(new UnsupportedUnitError('oz'), host);

    const body = json.mock.calls[0][0];
    expect(body.path).toBe('/workouts/prs');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('logs unexpected 500-level errors, not 400-level ones', () => {
    const errorSpy = jest.spyOn(filter['logger'], 'error').mockImplementation();
    const { host } = createMockHost();

    filter.catch(new Error('boom'), host);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockClear();
    filter.catch(new UnsupportedUnitError('oz'), host);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
