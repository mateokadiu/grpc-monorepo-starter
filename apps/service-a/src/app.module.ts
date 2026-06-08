import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [OrdersModule, HealthModule],
})
export class AppModule {}
