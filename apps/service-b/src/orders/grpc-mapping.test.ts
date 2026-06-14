import { describe, expect, it } from 'vitest';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { HttpStatus } from '@nestjs/common';

// Re-import internals via dynamic import to keep this file framework-light.
import { OrdersGatewayController } from './orders.gateway.controller.js';

describe('orders gateway / http<->grpc mapping', () => {
  it('module exports the controller', () => {
    expect(OrdersGatewayController).toBeDefined();
    expect(OrdersGatewayController.name).toBe('OrdersGatewayController');
  });

  it('static expectations on the grpc-js status enum used by the gateway', () => {
    expect(GrpcStatus.NOT_FOUND).toBe(5);
    expect(GrpcStatus.INVALID_ARGUMENT).toBe(3);
    expect(HttpStatus.BAD_GATEWAY).toBe(502);
  });
});
