import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  type CreateOrderRequest,
  type CreateOrderResponse,
  type GetOrderRequest,
  type Order,
  ORDERS_SERVICE_NAME,
  OrderStatus,
} from '@repo/proto-gen';

/**
 * OrdersController — protected by the JwtAuthInterceptor registered in
 * AppModule. The interceptor verifies the bearer token before this
 * handler runs; if it returns successfully here the caller is
 * authenticated.
 *
 * Backed by an in-memory map so the example stays self-contained.
 */
@Controller()
export class OrdersController {
  private readonly orders = new Map<string, Order>();

  @GrpcMethod(ORDERS_SERVICE_NAME, 'CreateOrder')
  createOrder(request: CreateOrderRequest): CreateOrderResponse {
    const order: Order = {
      id: `ord_${Math.random().toString(36).slice(2, 12)}`,
      customerId: request.customerId,
      lineItems: request.lineItems ?? [],
      totalCents: 0,
      currency: request.currency || 'USD',
      status: OrderStatus.ORDER_STATUS_PENDING,
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    return { order };
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'GetOrder')
  getOrder(request: GetOrderRequest): Order {
    const order = this.orders.get(request.id);
    if (!order) {
      // Re-use the same in-memory shape; downstream tests don't need the
      // full domain-error mapping from the non-auth service-a.
      return {
        id: '',
        customerId: '',
        lineItems: [],
        totalCents: 0,
        currency: '',
        status: OrderStatus.ORDER_STATUS_UNSPECIFIED,
        createdAt: '',
      };
    }
    return order;
  }
}
