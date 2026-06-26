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
  type ClientWritableStream,
  type ServiceError,
  Metadata,
  credentials,
} from '@grpc/grpc-js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BulkCreateOrdersResponse,
  type CreateOrderRequest,
  type LineItem,
  OrdersServiceService,
} from '@repo/proto-gen';
import { AppModule } from '../app.module.js';
import { OrdersStore } from '../orders/orders.store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const ordersProto = resolve(repoRoot, 'proto/orders/v1/orders.proto');
const healthProto = resolve(repoRoot, 'proto/grpc/health/v1/health.proto');

const TEST_PORT = 51451 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

/** Generate a stable test request — the line item is required so the
 *  store accepts it. */
function makeRequest(customerId: string, sku: string): CreateOrderRequest {
  const item: LineItem = { sku, name: sku, quantity: 1, unitPriceCents: 100 };
  return { customerId, currency: 'USD', lineItems: [item] };
}

/**
 * Drive a client-streaming RPC from an AsyncIterable of requests. Each
 * yielded value is written to the gRPC stream; iteration end triggers
 * end() and we wait for the server's single response.
 */
function callClientStreaming<TReq, TRes>(
  client: Client,
  method: {
    path: string;
    requestSerialize: (v: TReq) => Buffer;
    responseDeserialize: (b: Buffer) => TRes;
  },
  source: AsyncIterable<TReq>,
): Promise<TRes> {
  return new Promise((resolveP, rejectP) => {
    const stream = client.makeClientStreamRequest(
      method.path,
      method.requestSerialize,
      method.responseDeserialize,
      new Metadata(),
      {},
      (err, res) => (err ? rejectP(err) : resolveP(res as TRes)),
    ) as ClientWritableStream<TReq>;

    (async () => {
      try {
        for await (const msg of source) {
          if (!stream.write(msg)) {
            await new Promise<void>((r) => stream.once('drain', () => r()));
          }
        }
        stream.end();
      } catch (err) {
        stream.destroy(err as Error);
      }
    })().catch((err) => rejectP(err as ServiceError));
  });
}

describe('client-streaming / AsyncIterable input', () => {
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

  it('writes every yielded request and returns a summary', async () => {
    async function* source(): AsyncIterable<CreateOrderRequest> {
      for (let i = 0; i < 4; i += 1) yield makeRequest('cus_bulk', `SKU-${i}`);
    }
    const res = await callClientStreaming<CreateOrderRequest, BulkCreateOrdersResponse>(
      client,
      OrdersServiceService.bulkCreateOrders,
      source(),
    );
    expect(res.created).toBe(4);
    expect(res.failed).toBe(0);
    expect(res.createdIds).toHaveLength(4);
    // Every reported id is queryable in the store.
    for (const id of res.createdIds) {
      expect(store.get(id).customerId).toBe('cus_bulk');
    }
  });

  it('counts failures without aborting the stream', async () => {
    async function* source(): AsyncIterable<CreateOrderRequest> {
      yield makeRequest('cus_mixed', 'A');
      // Missing customerId — store rejects it.
      yield { customerId: '', currency: 'USD', lineItems: [] };
      yield makeRequest('cus_mixed', 'B');
    }
    const res = await callClientStreaming<CreateOrderRequest, BulkCreateOrdersResponse>(
      client,
      OrdersServiceService.bulkCreateOrders,
      source(),
    );
    expect(res.created).toBe(2);
    expect(res.failed).toBe(1);
    expect(res.createdIds).toHaveLength(2);
  });

  it('handles an empty input stream gracefully', async () => {
    async function* source(): AsyncIterable<CreateOrderRequest> {
      // Yield nothing — client immediately half-closes.
      if (false) yield makeRequest('x', 'x');
    }
    const res = await callClientStreaming<CreateOrderRequest, BulkCreateOrdersResponse>(
      client,
      OrdersServiceService.bulkCreateOrders,
      source(),
    );
    expect(res.created).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.createdIds).toEqual([]);
  });
});
