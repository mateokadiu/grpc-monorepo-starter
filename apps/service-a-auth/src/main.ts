import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  ORDERS_V1_PACKAGE,
  ORDERS_V1_PROTO_PATH,
} from '@repo/proto-gen';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const grpcPort = Number(process.env.GRPC_PORT ?? 50061);
  const grpcHost = process.env.GRPC_HOST ?? '0.0.0.0';

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');

  // Pure gRPC microservice (no HTTP). JWT verification happens in the
  // APP_INTERCEPTOR wired by AppModule.
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: ORDERS_V1_PACKAGE,
      protoPath: resolve(repoRoot, ORDERS_V1_PROTO_PATH),
      url: `${grpcHost}:${grpcPort}`,
      loader: { keepCase: false, longs: String, enums: String },
    },
  });

  await app.listen();
  // eslint-disable-next-line no-console
  console.log(
    `[service-a-auth] grpc=${grpcHost}:${grpcPort} package=${ORDERS_V1_PACKAGE} (JWT required)`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[service-a-auth] bootstrap failed', err);
  process.exit(1);
});
