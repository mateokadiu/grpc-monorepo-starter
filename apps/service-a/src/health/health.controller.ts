import { Controller, Get } from '@nestjs/common';

/**
 * GET /healthz — liveness probe.
 * The HTTP server runs alongside the gRPC microservice so the
 * platform can ping us without speaking gRPC.
 */
@Controller()
export class HealthController {
  @Get('healthz')
  healthz(): { status: 'ok'; ts: string } {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
