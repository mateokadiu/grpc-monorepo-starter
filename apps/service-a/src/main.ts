import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ORDERS_V1_PACKAGE, ORDERS_V1_PROTO_PATH } from '@repo/proto-gen';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const httpPort = Number(process.env.HTTP_PORT ?? 3000);
  const grpcPort = Number(process.env.GRPC_PORT ?? 50051);
  const grpcHost = process.env.GRPC_HOST ?? '0.0.0.0';

  // Locate proto/ relative to this file so the server runs under both
  // `pnpm dev` (cwd=apps/service-a) and `node dist/main.js` (any cwd).
  const here = dirname(fileURLToPath(import.meta.url));
  const protoPath = resolve(here, '..', '..', '..', ORDERS_V1_PROTO_PATH);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: ORDERS_V1_PACKAGE,
        protoPath,
        url: `${grpcHost}:${grpcPort}`,
        loader: { keepCase: false, longs: String, enums: String },
      },
    },
    { inheritAppConfig: true },
  );

  await app.startAllMicroservices();
  await app.listen(httpPort, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(
    `[service-a] http=:${httpPort} grpc=${grpcHost}:${grpcPort} package=${ORDERS_V1_PACKAGE}`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[service-a] bootstrap failed', err);
  process.exit(1);
});
