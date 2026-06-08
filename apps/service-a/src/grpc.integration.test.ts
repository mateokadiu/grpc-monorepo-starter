import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import {
  credentials,
  type Client,
  type ServiceError,
  Metadata,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import {
  type CreateOrderRequest,
  type CreateOrderResponse,
  type GetOrderRequest,
  type ListOrdersRequest,
  type Order,
  OrderStatus,
  OrdersServiceService,
} from '@repo/proto-gen';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { OrdersStore } from './orders/orders.store.js';

const here = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(here, '..', '..', '..', 'proto/orders/v1/orders.proto');

// Pick a high port unlikely to clash with the dev server.
const TEST_PORT = 51151 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

type RawClient = Client & {
  createOrder: (
    req: Buffer,
    md: Metadata,
    cb: (err: ServiceError | null, res: Buffer) => void,
  ) => unknown;
};

describe('service-a / grpc integration', () => {
  let app: NestFastifyApplication;
  let store: OrdersStore;
  let client: RawClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.GRPC,
        options: {
          package: 'orders.v1',
          protoPath,
          url: TEST_URL,
          loader: { keepCase: false, longs: String, enums: String },
        },
      },
      { inheritAppConfig: true },
    );
    await app.startAllMicroservices();
    // HTTP not strictly needed for these tests but Nest expects listen() pairing.
    await app.init();
    store = app.get(OrdersStore);
    store.clear();

    client = new (await import('@grpc/grpc-js')).Client(
      TEST_URL,
      credentials.createInsecure(),
    ) as RawClient;
  });

  afterAll(async () => {
    client.close();
    await app.close();
  });

  it('CreateOrder writes through to the store and returns the order', async () => {
    const req: CreateOrderRequest = {
      customerId: 'cus_int_1',
      currency: 'USD',
      lineItems: [{ sku: 'X', name: 'X', quantity: 2, unitPriceCents: 250 }],
    };
    const res = await new Promise<CreateOrderResponse>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        OrdersServiceService.createOrder.path,
        OrdersServiceService.createOrder.requestSerialize,
        OrdersServiceService.createOrder.responseDeserialize,
        req,
        new Metadata(),
        {},
        (err, value) => (err ? rejectP(err) : resolveP(value as CreateOrderResponse)),
      );
    });
    expect(res.order?.id).toMatch(/^ord_/);
    expect(res.order?.totalCents).toBe(500);
    expect(res.order?.status).toBe(OrderStatus.ORDER_STATUS_PENDING);
    expect(store.get(res.order!.id).customerId).toBe('cus_int_1');
  });

  it('GetOrder returns NOT_FOUND for missing ids', async () => {
    const err = await new Promise<ServiceError | null>((resolveP) => {
      client.makeUnaryRequest(
        OrdersServiceService.getOrder.path,
        OrdersServiceService.getOrder.requestSerialize,
        OrdersServiceService.getOrder.responseDeserialize,
        { id: 'ord_does_not_exist' } satisfies GetOrderRequest,
        new Metadata(),
        {},
        (e) => resolveP(e),
      );
    });
    expect(err?.code).toBe(GrpcStatus.NOT_FOUND);
  });

  it('CreateOrder returns INVALID_ARGUMENT when validation fails', async () => {
    const err = await new Promise<ServiceError | null>((resolveP) => {
      client.makeUnaryRequest(
        OrdersServiceService.createOrder.path,
        OrdersServiceService.createOrder.requestSerialize,
        OrdersServiceService.createOrder.responseDeserialize,
        { customerId: '', currency: 'USD', lineItems: [] } satisfies CreateOrderRequest,
        new Metadata(),
        {},
        (e) => resolveP(e),
      );
    });
    expect(err?.code).toBe(GrpcStatus.INVALID_ARGUMENT);
  });

  it('ListOrders streams all matching orders and completes', async () => {
    // Seed deterministic data, bypassing controller for setup speed.
    store.clear();
    for (let i = 0; i < 3; i += 1) {
      store.seed({
        id: `ord_stream_${i}`,
        customerId: 'cus_stream',
        lineItems: [],
        totalCents: 100 * i,
        currency: 'USD',
        status: OrderStatus.ORDER_STATUS_PAID,
        createdAt: `2026-06-0${i + 1}T00:00:00Z`,
      });
    }

    const received: Order[] = await new Promise((resolveP, rejectP) => {
      const stream = client.makeServerStreamRequest(
        OrdersServiceService.listOrders.path,
        OrdersServiceService.listOrders.requestSerialize,
        OrdersServiceService.listOrders.responseDeserialize,
        { customerId: 'cus_stream', limit: 0 } satisfies ListOrdersRequest,
        new Metadata(),
      );
      const out: Order[] = [];
      stream.on('data', (msg: Order) => out.push(msg));
      stream.on('end', () => resolveP(out));
      stream.on('error', rejectP);
    });

    expect(received.map((o) => o.id)).toEqual([
      'ord_stream_0',
      'ord_stream_1',
      'ord_stream_2',
    ]);
  });
});
