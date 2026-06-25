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
  type ClientReadableStream,
  Metadata,
  credentials,
} from '@grpc/grpc-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ListOrdersRequest,
  type Order,
  OrderStatus,
  OrdersServiceService,
} from '@repo/proto-gen';
import { AppModule } from '../app.module.js';
import { OrdersStore } from '../orders/orders.store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const ordersProto = resolve(repoRoot, 'proto/orders/v1/orders.proto');
const healthProto = resolve(repoRoot, 'proto/grpc/health/v1/health.proto');

const TEST_PORT = 51351 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

/**
 * Wrap a grpc-js ClientReadableStream in an AsyncIterable so callers can
 * consume with `for await (const order of orders)`. grpc-js exposes the
 * Node `Readable` surface — Symbol.asyncIterator is built-in — but
 * forcing the type makes the contract explicit at the call site.
 */
function asAsyncIterable<T>(stream: ClientReadableStream<T>): AsyncIterable<T> {
  return stream as unknown as AsyncIterable<T>;
}

describe('server-streaming / AsyncIterable for await', () => {
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
    for (let i = 0; i < 5; i += 1) {
      store.seed({
        id: `ord_stream_${i}`,
        customerId: 'cus_stream',
        lineItems: [],
        totalCents: 100 * (i + 1),
        currency: 'USD',
        status: OrderStatus.ORDER_STATUS_PAID,
        createdAt: `2026-06-0${i + 1}T00:00:00Z`,
      });
    }
    client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    );
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('drains a server stream via for-await', async () => {
    const stream = client.makeServerStreamRequest(
      OrdersServiceService.listOrders.path,
      OrdersServiceService.listOrders.requestSerialize,
      OrdersServiceService.listOrders.responseDeserialize,
      { customerId: 'cus_stream', limit: 0 } satisfies ListOrdersRequest,
      new Metadata(),
    ) as ClientReadableStream<Order>;

    const seen: string[] = [];
    for await (const order of asAsyncIterable(stream)) {
      seen.push(order.id);
    }
    expect(seen).toEqual([
      'ord_stream_0',
      'ord_stream_1',
      'ord_stream_2',
      'ord_stream_3',
      'ord_stream_4',
    ]);
  });

  it('honours server-side limits on the stream length', async () => {
    const stream = client.makeServerStreamRequest(
      OrdersServiceService.listOrders.path,
      OrdersServiceService.listOrders.requestSerialize,
      OrdersServiceService.listOrders.responseDeserialize,
      { customerId: 'cus_stream', limit: 2 } satisfies ListOrdersRequest,
      new Metadata(),
    ) as ClientReadableStream<Order>;

    const collected: Order[] = [];
    for await (const order of asAsyncIterable(stream)) collected.push(order);
    expect(collected).toHaveLength(2);
  });

  it('breaks early out of the for-await without leaking the connection', async () => {
    const stream = client.makeServerStreamRequest(
      OrdersServiceService.listOrders.path,
      OrdersServiceService.listOrders.requestSerialize,
      OrdersServiceService.listOrders.responseDeserialize,
      { customerId: 'cus_stream', limit: 0 } satisfies ListOrdersRequest,
      new Metadata(),
    ) as ClientReadableStream<Order>;

    let count = 0;
    for await (const _ of asAsyncIterable(stream)) {
      count += 1;
      if (count === 2) {
        stream.cancel();
        break;
      }
    }
    expect(count).toBe(2);
  });
});
