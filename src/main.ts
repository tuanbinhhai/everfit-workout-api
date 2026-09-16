import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  // Buffers Nest's own startup logs until configureApp() installs the pino
  // logger below, so they go through the same structured output too.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 3000;

  configureApp(app);

  await app.listen(port);
}

void bootstrap();
