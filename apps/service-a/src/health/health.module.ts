import { Module } from '@nestjs/common';
import {
  GrpcHealthController,
  HealthController,
  HealthRegistry,
} from './health.controller.js';

@Module({
  controllers: [GrpcHealthController, HealthController],
  providers: [HealthRegistry],
  exports: [HealthRegistry],
})
export class HealthModule {}
