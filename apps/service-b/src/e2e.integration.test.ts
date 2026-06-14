import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(here, '..', '..', '..', 'proto/orders/v1/orders.proto');

const GRPC_PORT = 51251 + Math.floor(Math.random() * 100);
const GRPC_URL = `127.0.0.1:${GRPC_PORT}`;
process.env.SERVICE_A_GRPC_URL = GRPC_URL;

describe('service-b / e2e http -> grpc -> service-a', () => {
  let serviceA: NestFastifyApplication;
  let serviceB: NestFastifyApplication;
  let serviceBUrl: string;

  beforeAll(async () => {
    // Boot service-a via its real AppModule, so the controllers + store are
    // wired the same way as production.
    const { AppModule: ServiceAModule } = await import('@repo/service-a/dist/app.module.js');
    const aRef = await Test.createTestingModule({ imports: [ServiceAModule] }).compile();
    serviceA = aRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    serviceA.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.GRPC,
        options: {
          package: 'orders.v1',
          protoPath,
          url: GRPC_URL,
          loader: { keepCase: false, longs: String, enums: String },
        },
      },
      { inheritAppConfig: true },
    );
    await serviceA.startAllMicroservices();
    await serviceA.init();

    const { AppModule } = await import('./app.module.js');
    const bRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    serviceB = bRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await serviceB.init();
    await serviceB.listen(0, '127.0.0.1');
    const address = serviceB.getHttpServer().address();
    if (typeof address === 'object' && address) {
      serviceBUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('service-b did not bind a port');
    }
  });

  afterAll(async () => {
    await serviceB.close();
    await serviceA.close();
  });

  it('POST /orders creates an order via gRPC and returns the result', async () => {
    const res = await fetch(`${serviceBUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer_id: 'cus_e2e',
        currency: 'USD',
        line_items: [{ sku: 'A', name: 'A', quantity: 2, unitPriceCents: 199 }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      order: { id: string; totalCents: number | string };
    };
    expect(body.order.id).toMatch(/^ord_/);
    // uint64 fields are surfaced as strings by @grpc/proto-loader when
    // `longs: String` is set — Number(...) flattens both shapes.
    expect(Number(body.order.totalCents)).toBe(398);
  });

  it('GET /orders/:id returns 404 when the upstream answers NOT_FOUND', async () => {
    const res = await fetch(`${serviceBUrl}/orders/ord_missing`);
    expect(res.status).toBe(404);
  });

  it('POST /orders → 400 when validation fails upstream', async () => {
    const res = await fetch(`${serviceBUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customer_id: '', line_items: [], currency: 'USD' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /orders (buffered) returns the JSON array from the stream', async () => {
    // Seed three orders via the public POST path so this exercises the
    // full HTTP -> gRPC -> store -> gRPC -> HTTP loop end-to-end.
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${serviceBUrl}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_id: 'cus_list',
          currency: 'USD',
          line_items: [{ sku: `S${i}`, name: `n${i}`, quantity: 1, unitPriceCents: 100 }],
        }),
      });
    }
    const res = await fetch(`${serviceBUrl}/orders?customer_id=cus_list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body).toHaveLength(3);
  });

  it('GET /orders?stream=ndjson streams NDJSON line-by-line', async () => {
    const res = await fetch(`${serviceBUrl}/orders?customer_id=cus_list&stream=ndjson`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      const obj = JSON.parse(line) as { id: string; customerId: string };
      expect(obj.id).toMatch(/^ord_/);
      expect(obj.customerId).toBe('cus_list');
    }
  });
});
