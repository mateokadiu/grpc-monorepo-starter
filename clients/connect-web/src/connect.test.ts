import { describe, expect, it } from 'vitest';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { OrdersService, OrderSchema, OrderStatus } from './gen/orders/v1/orders_pb.js';
import { UsersService, UserSchema, UserStatus } from './gen/users/v1/users_pb.js';

describe('connect-web / generated descriptors', () => {
  it('exposes OrdersService with the three expected RPCs', () => {
    expect(OrdersService.typeName).toBe('orders.v1.OrdersService');
    expect(Object.keys(OrdersService.method)).toEqual(
      expect.arrayContaining(['createOrder', 'getOrder', 'listOrders']),
    );
    // listOrders is server-streaming.
    expect(OrdersService.method.listOrders.methodKind).toBe('server_streaming');
    expect(OrdersService.method.createOrder.methodKind).toBe('unary');
  });

  it('exposes UsersService with the three expected RPCs', () => {
    expect(UsersService.typeName).toBe('users.v1.UsersService');
    expect(Object.keys(UsersService.method)).toEqual(
      expect.arrayContaining(['getUser', 'createUser', 'listUsers']),
    );
    expect(UsersService.method.listUsers.methodKind).toBe('server_streaming');
  });

  it('round-trips an Order message through binary encoding', () => {
    const order = create(OrderSchema, {
      id: 'ord_x',
      customerId: 'cus_1',
      totalCents: 500n,
      currency: 'USD',
      status: OrderStatus.PAID,
      createdAt: '2026-06-24T00:00:00Z',
    });
    const bytes = toBinary(OrderSchema, order);
    const decoded = fromBinary(OrderSchema, bytes);
    expect(decoded.id).toBe('ord_x');
    expect(decoded.totalCents).toBe(500n);
    expect(decoded.status).toBe(OrderStatus.PAID);
  });

  it('round-trips a User message through binary encoding', () => {
    const user = create(UserSchema, {
      id: 'usr_1',
      email: 'a@b.c',
      displayName: 'A B',
      status: UserStatus.ACTIVE,
      createdAt: '2026-06-24T00:00:00Z',
    });
    const decoded = fromBinary(UserSchema, toBinary(UserSchema, user));
    expect(decoded.email).toBe('a@b.c');
    expect(decoded.status).toBe(UserStatus.ACTIVE);
  });
});
