import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { OrderNotFoundError, OrderValidationError } from './orders.store.js';

/**
 * Map domain errors to gRPC status codes. Centralised so the controller
 * stays declarative and so the mapping can be unit-tested in isolation.
 */
export function mapDomainErrorToGrpc(err: unknown): RpcException {
  if (err instanceof OrderNotFoundError) {
    return new RpcException({ code: GrpcStatus.NOT_FOUND, message: err.message });
  }
  if (err instanceof OrderValidationError) {
    return new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: err.message });
  }
  const message = err instanceof Error ? err.message : 'internal error';
  return new RpcException({ code: GrpcStatus.INTERNAL, message });
}
