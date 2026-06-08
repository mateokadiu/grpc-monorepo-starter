import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersStore } from './orders.store.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersStore],
  exports: [OrdersStore],
})
export class OrdersModule {}
