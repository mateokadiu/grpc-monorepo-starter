import { describe, expect, it } from 'vitest';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { mapDomainErrorToGrpc } from './grpc-errors.js';
import { OrderNotFoundError, OrderValidationError } from './orders.store.js';

describe('mapDomainErrorToGrpc', () => {
  it('maps OrderNotFoundError → NOT_FOUND', () => {
    const exc = mapDomainErrorToGrpc(new OrderNotFoundError('ord_x'));
    const err = exc.getError() as { code: number; message: string };
    expect(err.code).toBe(GrpcStatus.NOT_FOUND);
    expect(err.message).toContain('ord_x');
  });

  it('maps OrderValidationError → INVALID_ARGUMENT', () => {
    const exc = mapDomainErrorToGrpc(new OrderValidationError('bad'));
    const err = exc.getError() as { code: number; message: string };
    expect(err.code).toBe(GrpcStatus.INVALID_ARGUMENT);
  });

  it('maps unknown errors → INTERNAL', () => {
    const exc = mapDomainErrorToGrpc(new Error('boom'));
    const err = exc.getError() as { code: number; message: string };
    expect(err.code).toBe(GrpcStatus.INTERNAL);
    expect(err.message).toBe('boom');
  });
});
