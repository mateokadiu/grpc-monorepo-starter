import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { lastValueFrom, type Observable, toArray } from 'rxjs';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  GetOrderRequest,
  ListOrdersRequest,
  Order,
} from '@repo/proto-gen';
import { ORDERS_SERVICE_NAME } from '@repo/proto-gen';
import { ORDERS_CLIENT } from './orders.tokens.js';

/** Subset of the OrdersService surface that the gateway consumes. */
export interface OrdersServiceClient {
  createOrder(req: CreateOrderRequest): Observable<CreateOrderResponse>;
  getOrder(req: GetOrderRequest): Observable<Order>;
  listOrders(req: ListOrdersRequest): Observable<Order>;
}

/**
 * Wraps the ClientGrpc proxy so controllers depend on a Promise/Observable
 * API rather than the raw NestJS gRPC client. Demonstrates both unary and
 * server-streaming consumption patterns.
 */
@Injectable()
export class OrdersGatewayService implements OnModuleInit {
  private client!: OrdersServiceClient;

  constructor(@Inject(ORDERS_CLIENT) private readonly clientGrpc: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.clientGrpc.getService<OrdersServiceClient>(ORDERS_SERVICE_NAME);
  }

  createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    return lastValueFrom(this.client.createOrder(req));
  }

  getOrder(id: string): Promise<Order> {
    return lastValueFrom(this.client.getOrder({ id }));
  }

  /** Consume the server stream to completion and collect into an array. */
  listOrdersBuffered(req: ListOrdersRequest): Promise<Order[]> {
    return lastValueFrom(this.client.listOrders(req).pipe(toArray()));
  }

  /** Expose the raw Observable for callers who want backpressure. */
  listOrders$(req: ListOrdersRequest): Observable<Order> {
    return this.client.listOrders(req);
  }
}
