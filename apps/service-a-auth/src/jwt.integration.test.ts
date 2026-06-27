import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  type Client,
  type ServiceError,
  Metadata,
  credentials,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CreateOrderRequest,
  type CreateOrderResponse,
  type LineItem,
  OrdersServiceService,
} from '@repo/proto-gen';
import { AppModule } from './app.module.js';
import { signToken } from './auth/jwt.js';
import { makeAuthInterceptor } from './auth/client-interceptor.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const protoPath = resolve(repoRoot, 'proto/orders/v1/orders.proto');

const TEST_PORT = 51751 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

function payload(customerId: string, sku: string): CreateOrderRequest {
  const item: LineItem = { sku, name: sku, quantity: 1, unitPriceCents: 100 };
  return { customerId, currency: 'USD', lineItems: [item] };
}

describe('service-a-auth / JWT', () => {
  let app: Awaited<ReturnType<typeof Test.prototype.createTestingModule>> extends infer M
    ? M
    : never;

  let microservice: ReturnType<typeof setupApp> extends Promise<infer T> ? T : never;

  beforeAll(async () => {
    microservice = await setupApp();
  });

  afterAll(async () => {
    await microservice.close();
  });

  it('rejects calls with no authorization header', async () => {
    const client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    );
    const err = await unaryWithErr(client, payload('cus_x', 'A'), new Metadata());
    client.close();
    expect(err?.code).toBe(GrpcStatus.UNAUTHENTICATED);
  });

  it('rejects calls with a tampered token', async () => {
    const client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    );
    const md = new Metadata();
    md.set('authorization', 'Bearer not.a.real.jwt');
    const err = await unaryWithErr(client, payload('cus_x', 'A'), md);
    client.close();
    expect(err?.code).toBe(GrpcStatus.UNAUTHENTICATED);
  });

  it('accepts calls with a valid token and returns the created order', async () => {
    const token = await signToken({ sub: 'user_1', scope: 'orders:write' });
    const client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    );
    const md = new Metadata();
    md.set('authorization', `Bearer ${token}`);
    const res = await unary(client, payload('cus_authed', 'A'), md);
    client.close();
    expect(res.order?.customerId).toBe('cus_authed');
    expect(res.order?.id).toMatch(/^ord_/);
  });

  it('client-side Interceptor auto-attaches the token', async () => {
    const token = await signToken({ sub: 'user_auto' });
    const client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
      { interceptors: [makeAuthInterceptor(() => token)] },
    );
    const res = await unary(client, payload('cus_intercepted', 'A'), new Metadata());
    client.close();
    expect(res.order?.customerId).toBe('cus_intercepted');
  });
});

async function setupApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const ms = moduleRef.createNestMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'orders.v1',
      protoPath,
      url: TEST_URL,
      loader: { keepCase: false, longs: String, enums: String },
    },
  });
  await ms.listen();
  return ms;
}

function unary(
  client: Client,
  req: CreateOrderRequest,
  md: Metadata,
): Promise<CreateOrderResponse> {
  return new Promise((resolveP, rejectP) => {
    client.makeUnaryRequest(
      OrdersServiceService.createOrder.path,
      OrdersServiceService.createOrder.requestSerialize,
      OrdersServiceService.createOrder.responseDeserialize,
      req,
      md,
      {},
      (err, value) => (err ? rejectP(err) : resolveP(value as CreateOrderResponse)),
    );
  });
}

function unaryWithErr(
  client: Client,
  req: CreateOrderRequest,
  md: Metadata,
): Promise<ServiceError | null> {
  return new Promise((resolveP) => {
    client.makeUnaryRequest(
      OrdersServiceService.createOrder.path,
      OrdersServiceService.createOrder.requestSerialize,
      OrdersServiceService.createOrder.responseDeserialize,
      req,
      md,
      {},
      (err) => resolveP(err),
    );
  });
}
