/**
 * @repo/proto-gen — barrel re-export for generated proto bindings.
 *
 * Subpath imports work too: `import { Order } from '@repo/proto-gen/orders/v1'`
 * is identical to picking from this barrel.
 */
export * from './generated/orders/v1/orders.js';

/** Convenience constant — the canonical gRPC package name for the Orders service. */
export const ORDERS_V1_PACKAGE = 'orders.v1';

/** Convenience constant — proto file path relative to the repo root. */
export const ORDERS_V1_PROTO_PATH = 'proto/orders/v1/orders.proto';
