import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const httpPort = Number(process.env.HTTP_PORT ?? 3001);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );
  await app.listen(httpPort, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(
    `[service-b] http=:${httpPort} upstream=${process.env.SERVICE_A_GRPC_URL ?? 'localhost:50051'}`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[service-b] bootstrap failed', err);
  process.exit(1);
});
