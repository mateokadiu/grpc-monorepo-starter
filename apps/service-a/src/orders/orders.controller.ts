import { Controller } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Observable } from 'rxjs';
import {
  type BulkCreateOrdersResponse,
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
 * Observable for server-streaming. BulkCreateOrders (client-stream) and
 * EchoOrders (bidi) use @GrpcStreamMethod and accept an Observable of
 * incoming messages. Domain errors map to RpcException via
 * mapDomainErrorToGrpc.
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

  /**
   * Client-streaming — accumulate incoming requests, write each through
   * the store, and complete the observable with a single summary. Errors
   * on individual rows are counted but don't tear down the stream.
   */
  @GrpcStreamMethod(ORDERS_SERVICE_NAME, 'BulkCreateOrders')
  bulkCreateOrders(messages$: Observable<CreateOrderRequest>): Observable<BulkCreateOrdersResponse> {
    return new Observable<BulkCreateOrdersResponse>((subscriber) => {
      const createdIds: string[] = [];
      let failed = 0;
      const sub = messages$.subscribe({
        next: (request) => {
          try {
            const order = this.store.create({
              customerId: request.customerId,
              lineItems: request.lineItems ?? [],
              currency: request.currency,
            });
            createdIds.push(order.id);
          } catch {
            failed += 1;
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => {
          subscriber.next({ created: createdIds.length, failed, createdIds });
          subscriber.complete();
        },
      });
      return () => sub.unsubscribe();
    });
  }

  /**
   * Bidirectional — emit one Order per incoming CreateOrderRequest. The
   * server keeps the response stream open until the client half-closes
   * the request stream.
   */
  @GrpcStreamMethod(ORDERS_SERVICE_NAME, 'EchoOrders')
  echoOrders(messages$: Observable<CreateOrderRequest>): Observable<Order> {
    return new Observable<Order>((subscriber) => {
      const sub = messages$.subscribe({
        next: (request) => {
          try {
            const order = this.store.create({
              customerId: request.customerId,
              lineItems: request.lineItems ?? [],
              currency: request.currency,
            });
            subscriber.next(order);
          } catch (err) {
            if (err instanceof OrderValidationError) {
              subscriber.error(mapDomainErrorToGrpc(err));
            } else {
              subscriber.error(err);
            }
          }
        },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }
}
