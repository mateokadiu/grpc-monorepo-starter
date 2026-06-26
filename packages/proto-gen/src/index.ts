/**
 * @repo/proto-gen — barrel re-export for generated proto bindings.
 *
 * Two top-level packages ship today — `orders.v1` and `users.v1` — each
 * generated independently from `proto/<pkg>/v1/<pkg>.proto`. The orders
 * surface is re-exported at the root for backward compatibility with v0.1
 * callers; new code should prefer the subpath imports:
 *
 *     import { Order } from '@repo/proto-gen/orders/v1';
 *     import { User }  from '@repo/proto-gen/users/v1';
 *
 * Internal-shared types (e.g. `MessageFns<T>`, `protobufPackage`) are
 * deliberately excluded from the root barrel — they collide across
 * packages. Reach into the subpath when you need them.
 */
export {
  BulkCreateOrdersResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  GetOrderRequest,
  LineItem,
  ListOrdersRequest,
  Order,
  ORDERS_SERVICE_NAME,
  ORDERS_V1_PACKAGE_NAME,
  OrderStatus,
  orderStatusFromJSON,
  orderStatusToNumber,
  OrdersServiceControllerMethods,
  OrdersServiceService,
} from './generated/orders/v1/orders.js';
export type {
  OrdersServiceClient,
  OrdersServiceController,
  OrdersServiceServer,
} from './generated/orders/v1/orders.js';

/** Convenience constant — the canonical gRPC package name for the Orders service. */
export const ORDERS_V1_PACKAGE = 'orders.v1';

/** Convenience constant — proto file path relative to the repo root. */
export const ORDERS_V1_PROTO_PATH = 'proto/orders/v1/orders.proto';

/** Convenience constant — the canonical gRPC package name for the Users service. */
export const USERS_V1_PACKAGE = 'users.v1';

/** Convenience constant — proto file path relative to the repo root. */
export const USERS_V1_PROTO_PATH = 'proto/users/v1/users.proto';

/** Convenience constant — the canonical gRPC package name for the standard health service. */
export const GRPC_HEALTH_V1_PACKAGE = 'grpc.health.v1';

/** Convenience constant — proto file path relative to the repo root. */
export const GRPC_HEALTH_V1_PROTO_PATH = 'proto/grpc/health/v1/health.proto';
