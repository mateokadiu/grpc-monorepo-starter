import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthInterceptor } from './auth/server-interceptor.js';
import { OrdersController } from './orders/orders.controller.js';

@Module({
  controllers: [OrdersController],
  providers: [
    // Global gRPC interceptor — runs before every controller method and
    // short-circuits unauthenticated calls with status.UNAUTHENTICATED.
    { provide: APP_INTERCEPTOR, useClass: JwtAuthInterceptor },
  ],
})
export class AppModule {}
