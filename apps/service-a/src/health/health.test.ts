import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  type Client,
  Metadata,
  credentials,
} from '@grpc/grpc-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type HealthCheckRequest,
  type HealthCheckResponse,
  HealthCheckResponse_ServingStatus,
  HealthService,
} from '@repo/proto-gen/grpc/health/v1';
import { AppModule } from '../app.module.js';
import { HealthRegistry } from './health.controller.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const ordersProto = resolve(repoRoot, 'proto/orders/v1/orders.proto');
const healthProto = resolve(repoRoot, 'proto/grpc/health/v1/health.proto');

const TEST_PORT = 51251 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

interface RawClient extends Client {
  makeUnaryRequest: Client['makeUnaryRequest'];
  makeServerStreamRequest: Client['makeServerStreamRequest'];
}

describe('grpc.health.v1.Health', () => {
  let app: NestFastifyApplication;
  let registry: HealthRegistry;
  let client: RawClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.GRPC,
        options: {
          package: ['orders.v1', 'grpc.health.v1'],
          protoPath: [ordersProto, healthProto],
          url: TEST_URL,
          loader: { keepCase: false, longs: String, enums: String },
        },
      },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    await app.init();
    registry = app.get(HealthRegistry);
    client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    ) as RawClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('Check returns SERVING for the empty default service', async () => {
    const res = await new Promise<HealthCheckResponse>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        HealthService.check.path,
        HealthService.check.requestSerialize,
        HealthService.check.responseDeserialize,
        { service: '' } satisfies HealthCheckRequest,
        new Metadata(),
        {},
        (err, value) => (err ? rejectP(err) : resolveP(value as HealthCheckResponse)),
      );
    });
    expect(res.status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it('Check returns SERVICE_UNKNOWN for unregistered services', async () => {
    const res = await new Promise<HealthCheckResponse>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        HealthService.check.path,
        HealthService.check.requestSerialize,
        HealthService.check.responseDeserialize,
        { service: 'orders.v1.NeverRegistered' } satisfies HealthCheckRequest,
        new Metadata(),
        {},
        (err, value) => (err ? rejectP(err) : resolveP(value as HealthCheckResponse)),
      );
    });
    expect(res.status).toBe(HealthCheckResponse_ServingStatus.SERVICE_UNKNOWN);
  });

  it('Check reflects registry updates', async () => {
    registry.set('orders.v1.OrdersService', HealthCheckResponse_ServingStatus.SERVING);
    const ok = await new Promise<HealthCheckResponse>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        HealthService.check.path,
        HealthService.check.requestSerialize,
        HealthService.check.responseDeserialize,
        { service: 'orders.v1.OrdersService' } satisfies HealthCheckRequest,
        new Metadata(),
        {},
        (err, value) => (err ? rejectP(err) : resolveP(value as HealthCheckResponse)),
      );
    });
    expect(ok.status).toBe(HealthCheckResponse_ServingStatus.SERVING);

    registry.set('orders.v1.OrdersService', HealthCheckResponse_ServingStatus.NOT_SERVING);
    const down = await new Promise<HealthCheckResponse>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        HealthService.check.path,
        HealthService.check.requestSerialize,
        HealthService.check.responseDeserialize,
        { service: 'orders.v1.OrdersService' } satisfies HealthCheckRequest,
        new Metadata(),
        {},
        (err, value) => (err ? rejectP(err) : resolveP(value as HealthCheckResponse)),
      );
    });
    expect(down.status).toBe(HealthCheckResponse_ServingStatus.NOT_SERVING);
  });

  it('Watch emits the initial status and reacts to transitions', async () => {
    const received: HealthCheckResponse_ServingStatus[] = [];
    const stream = client.makeServerStreamRequest(
      HealthService.watch.path,
      HealthService.watch.requestSerialize,
      HealthService.watch.responseDeserialize,
      { service: 'orders.v1.WatchTest' } satisfies HealthCheckRequest,
      new Metadata(),
    );
    const drained = new Promise<void>((resolveP, rejectP) => {
      stream.on('data', (msg: HealthCheckResponse) => {
        received.push(msg.status);
        if (received.length === 2) stream.cancel();
      });
      stream.on('error', (err) => {
        if ((err as { code?: number }).code === 1 /* CANCELLED */) resolveP();
        else rejectP(err);
      });
      stream.on('end', () => resolveP());
    });

    // Allow the initial event to land before pushing a transition.
    await new Promise((r) => setTimeout(r, 30));
    registry.set('orders.v1.WatchTest', HealthCheckResponse_ServingStatus.SERVING);
    await drained;
    expect(received[0]).toBe(HealthCheckResponse_ServingStatus.SERVICE_UNKNOWN);
    expect(received[1]).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });
});
