import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import {
  type CreateOrderRequest,
  type CreateOrderResponse,
  type GetOrderRequest,
  type ListOrdersRequest,
  ORDERS_SERVICE_NAME,
  type Order,
} from '@repo/proto-gen';
import { OrderNotFoundError, OrderValidationError, OrdersStore } from './orders.store.js';
import { mapDomainErrorToGrpc } from './grpc-errors.js';

/**
 * OrdersController — gRPC server for orders.v1.OrdersService.
 *
 * Each @GrpcMethod hook is bound by name; ListOrders returns an
 * Observable for server-streaming. Domain errors map to RpcException
 * with the right grpc-js status code via mapDomainErrorToGrpc.
 */
@Controller()
export class OrdersController {
  constructor(private readonly store: OrdersStore) {}

  @GrpcMethod(ORDERS_SERVICE_NAME, 'CreateOrder')
  createOrder(request: CreateOrderRequest): CreateOrderResponse {
    try {
      const order = this.store.create({
        customerId: request.customerId,
        lineItems: request.lineItems ?? [],
        currency: request.currency,
      });
      return { order };
    } catch (err) {
      if (err instanceof OrderValidationError) throw mapDomainErrorToGrpc(err);
      throw err;
    }
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'GetOrder')
  getOrder(request: GetOrderRequest): Order {
    try {
      return this.store.get(request.id);
    } catch (err) {
      if (err instanceof OrderNotFoundError) throw mapDomainErrorToGrpc(err);
      throw err;
    }
  }

  @GrpcMethod(ORDERS_SERVICE_NAME, 'ListOrders')
  listOrders(request: ListOrdersRequest): Observable<Order> {
    const orders = this.store.list({
      customerId: request.customerId,
      limit: request.limit,
    });
    return new Observable<Order>((subscriber) => {
      for (const order of orders) subscriber.next(order);
      subscriber.complete();
    });
  }
}
