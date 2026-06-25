import { Controller, Get, Injectable } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { Observable, Subject } from 'rxjs';
import {
  type HealthCheckRequest,
  type HealthCheckResponse,
  HealthCheckResponse_ServingStatus,
  HEALTH_SERVICE_NAME,
} from '@repo/proto-gen/grpc/health/v1';

/**
 * Per-service serving-status registry, with a fan-out for Watch streams.
 * The default empty service ("") tracks process-level health and is what
 * orchestrators (k8s `grpc_health_probe`, Envoy, AWS ALB) check by
 * default. Add per-rpc-package entries via `set('orders.v1.OrdersService', …)`.
 */
@Injectable()
export class HealthRegistry {
  private readonly statuses = new Map<string, HealthCheckResponse_ServingStatus>();
  private readonly subjects = new Map<string, Subject<HealthCheckResponse>>();

  constructor() {
    // Default to SERVING for the process — flip to NOT_SERVING during
    // shutdown to drain traffic gracefully.
    this.statuses.set('', HealthCheckResponse_ServingStatus.SERVING);
  }

  get(service: string): HealthCheckResponse_ServingStatus {
    return this.statuses.get(service) ?? HealthCheckResponse_ServingStatus.SERVICE_UNKNOWN;
  }

  set(service: string, status: HealthCheckResponse_ServingStatus): void {
    this.statuses.set(service, status);
    this.subjects.get(service)?.next({ status });
  }

  watch$(service: string): Observable<HealthCheckResponse> {
    let subject = this.subjects.get(service);
    if (!subject) {
      subject = new Subject<HealthCheckResponse>();
      this.subjects.set(service, subject);
    }
    return new Observable<HealthCheckResponse>((subscriber) => {
      subscriber.next({ status: this.get(service) });
      const sub = subject.subscribe(subscriber);
      return () => sub.unsubscribe();
    });
  }
}

/**
 * grpc.health.v1.Health — standard probe surface.
 *
 * Speaks two RPCs: a unary Check that orchestrators hit per probe, and a
 * server-streaming Watch that emits status transitions. The empty service
 * name ("") represents process liveness; named services let callers
 * probe a specific subsystem.
 */
@Controller()
export class GrpcHealthController {
  constructor(private readonly registry: HealthRegistry) {}

  @GrpcMethod(HEALTH_SERVICE_NAME, 'Check')
  check(request: HealthCheckRequest): HealthCheckResponse {
    return { status: this.registry.get(request.service ?? '') };
  }

  @GrpcMethod(HEALTH_SERVICE_NAME, 'Watch')
  watch(request: HealthCheckRequest): Observable<HealthCheckResponse> {
    return this.registry.watch$(request.service ?? '');
  }
}

/**
 * GET /healthz — HTTP liveness probe. Kept alongside the gRPC Health
 * service so the platform can ping us without speaking gRPC.
 */
@Controller()
export class HealthController {
  @Get('healthz')
  healthz(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
