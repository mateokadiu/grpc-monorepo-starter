import { describe, expect, it } from 'vitest';
import {
  CreateOrderRequest,
  type LineItem,
  Order,
  OrderStatus,
  ORDERS_V1_PACKAGE,
  ORDERS_V1_PROTO_PATH,
  ORDERS_SERVICE_NAME,
  OrdersServiceService,
  orderStatusFromJSON,
  orderStatusToNumber,
} from './index.js';

describe('proto-gen / orders.v1', () => {
  it('exposes the canonical package + proto path constants', () => {
    expect(ORDERS_V1_PACKAGE).toBe('orders.v1');
    expect(ORDERS_V1_PROTO_PATH).toBe('proto/orders/v1/orders.proto');
    expect(ORDERS_SERVICE_NAME).toBe('OrdersService');
  });

  it('round-trips an Order through binary encode/decode', () => {
    const order: Order = {
      id: 'ord_01HZX9',
      customerId: 'cus_42',
      lineItems: [{ sku: 'SKU-A', name: 'Espresso', quantity: 2, unitPriceCents: 350 }],
      totalCents: 700,
      currency: 'USD',
      status: OrderStatus.ORDER_STATUS_PAID,
      createdAt: '2026-06-01T12:00:00Z',
    };
    const bytes = Order.encode(order).finish();
    const decoded = Order.decode(bytes);
    expect(decoded.id).toBe(order.id);
    expect(decoded.customerId).toBe(order.customerId);
    expect(decoded.lineItems).toHaveLength(1);
    expect(decoded.lineItems[0]?.sku).toBe('SKU-A');
    expect(decoded.totalCents).toBe(700);
    expect(decoded.status).toBe(OrderStatus.ORDER_STATUS_PAID);
  });

  it('round-trips a CreateOrderRequest with multiple line items', () => {
    const lineItems: LineItem[] = [
      { sku: 'A', name: 'a', quantity: 1, unitPriceCents: 100 },
      { sku: 'B', name: 'b', quantity: 3, unitPriceCents: 250 },
    ];
    const req: CreateOrderRequest = { customerId: 'c1', lineItems, currency: 'EUR' };
    const decoded = CreateOrderRequest.decode(CreateOrderRequest.encode(req).finish());
    expect(decoded.customerId).toBe('c1');
    expect(decoded.lineItems).toHaveLength(2);
    expect(decoded.currency).toBe('EUR');
  });

  it('maps OrderStatus enum to/from proto numeric values', () => {
    expect(orderStatusFromJSON(2)).toBe(OrderStatus.ORDER_STATUS_PAID);
    expect(orderStatusFromJSON('ORDER_STATUS_SHIPPED')).toBe(OrderStatus.ORDER_STATUS_SHIPPED);
    expect(orderStatusToNumber(OrderStatus.ORDER_STATUS_DELIVERED)).toBe(4);
  });

  it('declares the OrdersService gRPC service with the three RPCs', () => {
    const paths = Object.values(OrdersServiceService).map((m) => m.path);
    expect(paths).toContain('/orders.v1.OrdersService/CreateOrder');
    expect(paths).toContain('/orders.v1.OrdersService/GetOrder');
    expect(paths).toContain('/orders.v1.OrdersService/ListOrders');
    expect(OrdersServiceService.listOrders.responseStream).toBe(true);
    expect(OrdersServiceService.createOrder.responseStream).toBe(false);
  });
});
