import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type LineItem,
  type Order,
  OrderStatus,
} from '@repo/proto-gen';

/**
 * Domain error thrown when a line item violates basic invariants.
 * The gRPC layer maps this to INVALID_ARGUMENT.
 */
export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderValidationError';
  }
}

/** Domain error for missing-order lookups. Maps to NOT_FOUND. */
export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`order ${id} not found`);
    this.name = 'OrderNotFoundError';
  }
}

export interface CreateOrderInput {
  customerId: string;
  lineItems: LineItem[];
  currency: string;
}

/**
 * In-memory order store. Demonstrates the wiring — swap for Postgres,
 * Drizzle, etc. in your fork. Read by OrdersController to back the
 * three RPCs; covered by orders.store.test.ts.
 */
@Injectable()
export class OrdersStore {
  private readonly orders = new Map<string, Order>();

  create(input: CreateOrderInput): Order {
    if (!input.customerId) {
      throw new OrderValidationError('customer_id is required');
    }
    if (input.lineItems.length === 0) {
      throw new OrderValidationError('at least one line_item is required');
    }
    for (const li of input.lineItems) {
      if (li.quantity <= 0) {
        throw new OrderValidationError(`line_item ${li.sku} quantity must be > 0`);
      }
    }
    const totalCents = input.lineItems.reduce(
      (sum, li) => sum + BigInt(li.quantity) * BigInt(li.unitPriceCents),
      0n,
    );
    const order: Order = {
      id: `ord_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      customerId: input.customerId,
      lineItems: input.lineItems,
      totalCents: Number(totalCents),
      currency: input.currency || 'USD',
      status: OrderStatus.ORDER_STATUS_PENDING,
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  get(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new OrderNotFoundError(id);
    return order;
  }

  list({ customerId, limit }: { customerId?: string; limit?: number }): Order[] {
    const filtered = customerId
      ? Array.from(this.orders.values()).filter((o) => o.customerId === customerId)
      : Array.from(this.orders.values());
    const sorted = filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  }

  /** Test seam — clear all orders. Not exposed via gRPC. */
  clear(): void {
    this.orders.clear();
  }

  /** Test seam — bypass create() validation for fixture data. */
  seed(order: Order): void {
    this.orders.set(order.id, order);
  }
}
