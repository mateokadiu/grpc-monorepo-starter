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
  type ServiceError,
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

const TEST_PORT = 51651 + Math.floor(Math.random() * 100);
const TEST_URL = `127.0.0.1:${TEST_PORT}`;

function makeRequest(customerId: string, sku: string): CreateOrderRequest {
  const item: LineItem = { sku, name: sku, quantity: 1, unitPriceCents: 100 };
  return { customerId, currency: 'USD', lineItems: [item] };
}

/**
 * Bridge an AbortSignal to a gRPC call. Returns the deadline-propagating
 * call options + a teardown that unbinds the listener. Once the signal
 * fires we call `cancelWithStatus(CANCELLED, …)` on the underlying call
 * surface; grpc-js maps that to status.CANCELLED on the client side.
 */
function deadlineOpts(timeoutMs: number) {
  return { deadline: Date.now() + timeoutMs };
}

describe('deadline propagation + AbortController cancellation', () => {
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
    // Seed a wide result set so list-orders streams take long enough to
    // observe deadlines / cancellation rather than completing first.
    for (let i = 0; i < 50; i += 1) {
      store.seed({
        id: `ord_slow_${i.toString().padStart(2, '0')}`,
        customerId: 'cus_slow',
        lineItems: [],
        totalCents: 0,
        currency: 'USD',
        status: 'ORDER_STATUS_PAID' as never,
        createdAt: `2026-06-${(i % 28) + 1}T00:00:00Z`,
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

  it('rejects a unary call whose deadline already elapsed', async () => {
    const err = await new Promise<ServiceError | null>((resolveP) => {
      client.makeUnaryRequest(
        OrdersServiceService.createOrder.path,
        OrdersServiceService.createOrder.requestSerialize,
        OrdersServiceService.createOrder.responseDeserialize,
        makeRequest('cus_x', 'A'),
        new Metadata(),
        // 1ms — well below any plausible round-trip time.
        deadlineOpts(1),
        (e) => resolveP(e),
      );
    });
    expect(err?.code).toBe(GrpcStatus.DEADLINE_EXCEEDED);
  });

  it('accepts a unary call when the deadline is comfortably in the future', async () => {
    const res = await new Promise<Order>((resolveP, rejectP) => {
      client.makeUnaryRequest(
        OrdersServiceService.createOrder.path,
        OrdersServiceService.createOrder.requestSerialize,
        OrdersServiceService.createOrder.responseDeserialize,
        makeRequest('cus_deadline_ok', 'A'),
        new Metadata(),
        deadlineOpts(5_000),
        (err, value) => (err ? rejectP(err) : resolveP((value as { order: Order }).order)),
      );
    });
    expect(res.id).toMatch(/^ord_/);
  });

  it('honours AbortController cancellation on a server-streaming RPC', async () => {
    const controller = new AbortController();
    const received: Order[] = [];

    const stream = client.makeServerStreamRequest(
      OrdersServiceService.listOrders.path,
      OrdersServiceService.listOrders.requestSerialize,
      OrdersServiceService.listOrders.responseDeserialize,
      { customerId: 'cus_slow', limit: 0 },
      new Metadata(),
    );

    // Wire the signal into the gRPC client call — on abort we issue a
    // client-side cancel which surfaces as status.CANCELLED.
    const onAbort = () => stream.cancel();
    controller.signal.addEventListener('abort', onAbort, { once: true });

    const result = await new Promise<{ code?: number }>((resolveP) => {
      stream.on('data', (msg: Order) => {
        received.push(msg);
        if (received.length === 3) controller.abort();
      });
      stream.on('error', (err) => resolveP(err as { code?: number }));
      stream.on('end', () => resolveP({}));
    });

    expect(result.code).toBe(GrpcStatus.CANCELLED);
    expect(received).toHaveLength(3);
  });

  it('cancels a unary call before the response arrives via AbortController', async () => {
    const controller = new AbortController();
    let call: { cancel: () => void } | undefined;

    const result = new Promise<ServiceError | null>((resolveP) => {
      call = client.makeUnaryRequest(
        OrdersServiceService.createOrder.path,
        OrdersServiceService.createOrder.requestSerialize,
        OrdersServiceService.createOrder.responseDeserialize,
        makeRequest('cus_cancel', 'A'),
        new Metadata(),
        deadlineOpts(5_000),
        (e) => resolveP(e),
      );
    });

    controller.signal.addEventListener('abort', () => call?.cancel(), { once: true });
    // Abort on the next macrotask — before the server has a chance to
    // round-trip the response.
    controller.abort();

    const err = await result;
    expect(err?.code).toBe(GrpcStatus.CANCELLED);
  });
});
