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
  type ClientDuplexStream,
  Metadata,
  credentials,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CreateOrderRequest,
  type LineItem,
  type Order,
  OrdersServiceService,
} from '@repo/proto-gen';
import { AppModule } from '../app.module.js';
import { OrdersStore } from '../orders/orders.store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const ordersProto = resolve(repoRoot, 'proto/orders/v1/orders.proto');
const healthProto = resolve(repoRoot, 'proto/grpc/health/v1/health.proto');

const TEST_PORT = 51551 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

function makeRequest(customerId: string, sku: string): CreateOrderRequest {
  const item: LineItem = { sku, name: sku, quantity: 1, unitPriceCents: 100 };
  return { customerId, currency: 'USD', lineItems: [item] };
}

/** Open a bidirectional stream; returns the duplex once writable. */
function openEcho(client: Client): ClientDuplexStream<CreateOrderRequest, Order> {
  return client.makeBidiStreamRequest(
    OrdersServiceService.echoOrders.path,
    OrdersServiceService.echoOrders.requestSerialize,
    OrdersServiceService.echoOrders.responseDeserialize,
    new Metadata(),
    {},
  ) as ClientDuplexStream<CreateOrderRequest, Order>;
}

describe('bidirectional streaming', () => {
  let app: NestFastifyApplication;
  let store: OrdersStore;
  let client: Client;

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
    store = app.get(OrdersStore);
    store.clear();
    client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    );
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('emits one response per request and completes on client half-close', async () => {
    const stream = openEcho(client);
    const received: Order[] = [];
    const done = new Promise<void>((resolveP, rejectP) => {
      stream.on('data', (o: Order) => received.push(o));
      stream.on('end', () => resolveP());
      stream.on('error', rejectP);
    });

    const inputs = [
      makeRequest('cus_bidi', 'A'),
      makeRequest('cus_bidi', 'B'),
      makeRequest('cus_bidi', 'C'),
    ];
    for (const req of inputs) stream.write(req);
    stream.end();
    await done;

    expect(received).toHaveLength(3);
    expect(received.map((o) => o.customerId)).toEqual(['cus_bidi', 'cus_bidi', 'cus_bidi']);
  });

  it('keeps the stream open across interleaved writes and reads', async () => {
    const stream = openEcho(client);
    const received: Order[] = [];

    stream.on('data', (o: Order) => received.push(o));
    const finished = new Promise<void>((r) => stream.on('end', () => r()));

    // Write — pause — write pattern; server returns one response per
    // request, but only after each individual write.
    stream.write(makeRequest('cus_interleave', 'X'));
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(1);

    stream.write(makeRequest('cus_interleave', 'Y'));
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toHaveLength(2);

    stream.end();
    await finished;
    expect(received[0]?.id).not.toBe(received[1]?.id);
  });

  it('propagates a domain validation error mid-stream as INVALID_ARGUMENT', async () => {
    const stream = openEcho(client);
    const received: Order[] = [];
    const captured = new Promise<{ code?: number }>((resolveP) => {
      stream.on('data', (o: Order) => received.push(o));
      stream.on('error', (err) => resolveP(err as { code?: number }));
      stream.on('end', () => resolveP({}));
    });

    stream.write(makeRequest('cus_ok', 'A'));
    // Missing customerId triggers an OrderValidationError on the server.
    stream.write({ customerId: '', currency: 'USD', lineItems: [] });
    // Don't end — the server will already have failed the stream.

    const result = await captured;
    expect(result.code).toBe(GrpcStatus.INVALID_ARGUMENT);
  });
});
