import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { UnsupportedUnitError } from '../../unit-conversion/unsupported-unit.error';
import { InvalidCursorError } from '../../workouts/cursor';
import { FieldError } from '../validation/format-validation-errors';

export interface StructuredErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details: FieldError[];
  timestamp: string;
  path: string;
}

interface MappedException {
  statusCode: number;
  error: string;
  message: string;
  details: FieldError[];
}

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
};

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapped = this.mapException(exception);

    if (mapped.statusCode >= 500) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: StructuredErrorBody = {
      ...mapped,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(mapped.statusCode).json(body);
  }

  private mapException(exception: unknown): MappedException {
    if (exception instanceof UnsupportedUnitError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: STATUS_NAMES[HttpStatus.BAD_REQUEST],
        message: exception.message,
        details: [{ field: 'unit', issue: exception.message }],
      };
    }

    if (exception instanceof InvalidCursorError) {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: STATUS_NAMES[HttpStatus.BAD_REQUEST],
        message: exception.message,
        details: [{ field: 'cursor', issue: exception.message }],
      };
    }

    if (exception instanceof HttpException) {
      return this.mapHttpException(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: STATUS_NAMES[HttpStatus.INTERNAL_SERVER_ERROR],
      message: 'An unexpected error occurred.',
      details: [],
    };
  }

  private mapHttpException(exception: HttpException): MappedException {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'object' && payload !== null) {
      const body = payload as {
        message?: string | string[];
        details?: FieldError[];
        error?: string;
      };

      if (body.details) {
        return {
          statusCode,
          error: body.error ?? STATUS_NAMES[statusCode] ?? 'Error',
          message:
            typeof body.message === 'string'
              ? body.message
              : 'Validation failed',
          details: body.details,
        };
      }

      const messages = Array.isArray(body.message)
        ? body.message
        : [body.message ?? exception.message];

      return {
        statusCode,
        error: body.error ?? STATUS_NAMES[statusCode] ?? 'Error',
        message: messages.length === 1 ? messages[0] : 'Validation failed',
        details: messages.map((issue) => ({ field: '', issue })),
      };
    }

    return {
      statusCode,
      error: STATUS_NAMES[statusCode] ?? 'Error',
      message: exception.message,
      details: [],
    };
  }
}
