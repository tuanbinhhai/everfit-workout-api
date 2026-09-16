import {
  BadRequestException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { Logger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { formatValidationErrors } from './common/validation/format-validation-errors';

// Shared by main.ts (real app) and e2e test bootstrapping, so tests exercise
// the exact same logger/pipe/filter behavior as production rather than
// risking drift.
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: 'Validation failed',
          details: formatValidationErrors(errors),
        }),
    }),
  );
}
