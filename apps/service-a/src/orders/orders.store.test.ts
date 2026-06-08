import { beforeEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@repo/proto-gen';
import {
  OrderNotFoundError,
  OrderValidationError,
  OrdersStore,
} from './orders.store.js';

describe('OrdersStore', () => {
  let store: OrdersStore;
  beforeEach(() => {
    store = new OrdersStore();
  });

  it('creates an order with computed total and PENDING status', () => {
    const order = store.create({
      customerId: 'cus_1',
      currency: 'USD',
      lineItems: [
        { sku: 'A', name: 'A', quantity: 2, unitPriceCents: 100 },
        { sku: 'B', name: 'B', quantity: 1, unitPriceCents: 250 },
      ],
    });
    expect(order.id).toMatch(/^ord_/);
    expect(order.totalCents).toBe(450);
    expect(order.status).toBe(OrderStatus.ORDER_STATUS_PENDING);
    expect(order.currency).toBe('USD');
    expect(order.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('defaults currency to USD when blank', () => {
    const order = store.create({
      customerId: 'cus_2',
      currency: '',
      lineItems: [{ sku: 'A', name: 'A', quantity: 1, unitPriceCents: 100 }],
    });
    expect(order.currency).toBe('USD');
  });

  it('rejects orders with no line items', () => {
    expect(() => store.create({ customerId: 'cus_1', currency: 'USD', lineItems: [] })).toThrow(
      OrderValidationError,
    );
  });

  it('rejects orders with missing customer_id', () => {
    expect(() =>
      store.create({
        customerId: '',
        currency: 'USD',
        lineItems: [{ sku: 'A', name: 'A', quantity: 1, unitPriceCents: 100 }],
      }),
    ).toThrow(OrderValidationError);
  });

  it('rejects line items with non-positive quantity', () => {
    expect(() =>
      store.create({
        customerId: 'cus_1',
        currency: 'USD',
        lineItems: [{ sku: 'A', name: 'A', quantity: 0, unitPriceCents: 100 }],
      }),
    ).toThrow(OrderValidationError);
  });

  it('get throws OrderNotFoundError for unknown id', () => {
    expect(() => store.get('ord_missing')).toThrow(OrderNotFoundError);
  });

  it('lists orders filtered by customer_id and ordered by createdAt', async () => {
    const a = store.create({
      customerId: 'cus_1',
      currency: 'USD',
      lineItems: [{ sku: 'A', name: 'A', quantity: 1, unitPriceCents: 100 }],
    });
    // ensure a strictly-later createdAt
    await new Promise((r) => setTimeout(r, 5));
    const b = store.create({
      customerId: 'cus_2',
      currency: 'USD',
      lineItems: [{ sku: 'B', name: 'B', quantity: 1, unitPriceCents: 200 }],
    });
    const all = store.list({});
    expect(all.map((o) => o.id)).toEqual([a.id, b.id]);
    const filtered = store.list({ customerId: 'cus_2' });
    expect(filtered.map((o) => o.id)).toEqual([b.id]);
  });

  it('caps list output when limit is set', () => {
    for (let i = 0; i < 5; i += 1) {
      store.create({
        customerId: 'cus_x',
        currency: 'USD',
        lineItems: [{ sku: `S${i}`, name: `n${i}`, quantity: 1, unitPriceCents: 100 }],
      });
    }
    expect(store.list({ limit: 2 })).toHaveLength(2);
    expect(store.list({ limit: 0 })).toHaveLength(5);
  });
});
