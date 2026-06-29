import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { LineItem, Order } from '@repo/proto-gen';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { OrdersGatewayService } from './orders.gateway.service.js';

/**
 * Accepts both snake_case and camelCase on the wire so a `curl -d '{...}'`
 * caller doesn't have to know that the inner LineItem objects flow straight
 * through to the gRPC layer. The outer body is snake (HTTP-idiomatic), the
 * inner objects can be either.
 */
interface LineItemBody {
  sku?: string;
  name?: string;
  quantity?: number;
  unit_price_cents?: number | string;
  unitPriceCents?: number | string;
}

interface CreateOrderBody {
  customer_id?: string;
  customerId?: string;
  currency?: string;
  line_items?: LineItemBody[];
  lineItems?: LineItemBody[];
}

function toLineItem(raw: LineItemBody): LineItem {
  const priceRaw = raw.unitPriceCents ?? raw.unit_price_cents ?? 0;
  return {
    sku: raw.sku ?? '',
    name: raw.name ?? '',
    quantity: Number(raw.quantity ?? 0),
    unitPriceCents: typeof priceRaw === 'string' ? Number(priceRaw) : priceRaw,
  };
}

/**
 * Maps a grpc-js status code on a thrown error to an HTTP status. The
 * default is 502 Bad Gateway — explicit acknowledgement that the failure
 * came from an upstream RPC.
 */
function grpcCodeToHttp(code: number | undefined): HttpStatus {
  switch (code) {
    case GrpcStatus.NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case GrpcStatus.INVALID_ARGUMENT:
      return HttpStatus.BAD_REQUEST;
    case GrpcStatus.UNAUTHENTICATED:
      return HttpStatus.UNAUTHORIZED;
    case GrpcStatus.PERMISSION_DENIED:
      return HttpStatus.FORBIDDEN;
    case GrpcStatus.RESOURCE_EXHAUSTED:
      return HttpStatus.TOO_MANY_REQUESTS;
    default:
      return HttpStatus.BAD_GATEWAY;
  }
}

function rethrowAsHttp(err: unknown): never {
  const e = err as { code?: number; details?: string; message?: string };
  throw new HttpException(
    { message: e.details ?? e.message ?? 'upstream error', grpcCode: e.code ?? null },
    grpcCodeToHttp(e.code),
  );
}

@Controller('orders')
export class OrdersGatewayController {
  constructor(private readonly gateway: OrdersGatewayService) {}

  /** POST /orders — delegates to OrdersService.CreateOrder via gRPC. */
  @Post()
  async create(@Body() body: CreateOrderBody): Promise<{ order: Order | undefined }> {
    try {
      const lineItemsRaw = body.line_items ?? body.lineItems ?? [];
      const res = await this.gateway.createOrder({
        customerId: body.customer_id ?? body.customerId ?? '',
        currency: body.currency ?? 'USD',
        lineItems: lineItemsRaw.map(toLineItem),
      });
      return { order: res.order };
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  /** GET /orders/:id — unary lookup. */
  @Get(':id')
  async getOne(@Param('id') id: string): Promise<Order> {
    try {
      return await this.gateway.getOrder(id);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }

  /**
   * GET /orders?customer_id=&limit=
   *
   * Default: buffer the entire stream and respond with a JSON array.
   * Pass `?stream=ndjson` to receive a newline-delimited JSON stream —
   * the most direct way to forward a gRPC server-stream over HTTP/1.1.
   */
  @Get()
  async list(
    @Query('customer_id') customerId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('stream') stream: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Order[] | void> {
    const request = {
      customerId: customerId ?? '',
      limit: limit ? Number(limit) : 0,
    };

    if (stream === 'ndjson') {
      reply.raw.setHeader('content-type', 'application/x-ndjson');
      reply.raw.setHeader('cache-control', 'no-store');
      reply.hijack();
      const sub = this.gateway.listOrders$(request).subscribe({
        next: (order) => reply.raw.write(`${JSON.stringify(order)}\n`),
        error: (err) => {
          reply.raw.statusCode = 502;
          reply.raw.write(JSON.stringify({ error: String(err) }));
          reply.raw.end();
        },
        complete: () => reply.raw.end(),
      });
      req.raw.on('close', () => sub.unsubscribe());
      return;
    }

    try {
      return await this.gateway.listOrdersBuffered(request);
    } catch (err) {
      rethrowAsHttp(err);
    }
  }
}
