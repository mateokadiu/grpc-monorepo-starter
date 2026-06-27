import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  Logger,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { type Metadata, status as GrpcStatus } from '@grpc/grpc-js';
import { verifyToken } from './jwt.js';

const PUBLIC_RPC_PREFIXES = ['grpc.health.v1.', 'grpc.reflection.v1.'] as const;

/**
 * Server-side JWT interceptor.
 *
 * Pulls the `authorization` Metadata header from the inbound gRPC call,
 * strips the `Bearer ` prefix, and verifies via jose. On failure the
 * RPC fails with UNAUTHENTICATED before the controller runs. Health +
 * reflection RPCs are exempt so orchestrators can probe unauthenticated.
 *
 * The verified claims are attached to the gRPC `Metadata.options` bag
 * under `authClaims` for downstream handlers to read via @Ctx().
 *
 * Wire it globally:
 *
 *     app.useGlobalInterceptors(new JwtAuthInterceptor());
 *
 * Equivalent to a @grpc/grpc-js client-side Interceptor on the wire —
 * both surfaces speak Metadata.
 */
@Injectable()
export class JwtAuthInterceptor implements NestInterceptor {
  private readonly logger = new Logger(JwtAuthInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();

    const rpc = context.switchToRpc();
    const metadata = rpc.getContext<Metadata>();

    // service-name + method available on the @nestjs/microservices ctx;
    // we don't have the path string at this layer, but we can sniff the
    // handler class name to permit Health / Reflection probes.
    const handlerName = context.getClass().name;
    if (PUBLIC_RPC_PREFIXES.some((p) => handlerName.toLowerCase().includes(p.split('.')[1] ?? ''))) {
      return next.handle();
    }

    const header = metadata?.get?.('authorization')?.[0];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return throwUnauthenticated('missing or malformed authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    return from(verifyToken(token)).pipe(
      switchMap((claims) => {
        // Stash claims on the metadata's internal options bag — Nest
        // surfaces this via `@Ctx()` to controllers.
        (metadata as Metadata & { authClaims?: unknown }).authClaims = claims;
        this.logger.debug(`auth ok sub=${claims.sub}`);
        return next.handle();
      }),
      catchError((err: unknown) =>
        throwError(
          () =>
            new RpcException({
              code: GrpcStatus.UNAUTHENTICATED,
              message: `jwt verification failed: ${(err as Error).message}`,
            }),
        ),
      ),
    );
  }
}

function throwUnauthenticated(details: string): Observable<never> {
  return new Observable((subscriber) => {
    subscriber.error(
      new RpcException({ code: GrpcStatus.UNAUTHENTICATED, message: details }),
    );
  });
}
