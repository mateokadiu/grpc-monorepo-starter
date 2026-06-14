import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDERS_V1_PACKAGE, ORDERS_V1_PROTO_PATH } from '@repo/proto-gen';
import { OrdersGatewayController } from './orders/orders.gateway.controller.js';
import { OrdersGatewayService } from './orders/orders.gateway.service.js';
import { ORDERS_CLIENT } from './orders/orders.tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(here, '..', '..', '..', ORDERS_V1_PROTO_PATH);

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ORDERS_CLIENT,
        useFactory: () => ({
          transport: Transport.GRPC,
          options: {
            package: ORDERS_V1_PACKAGE,
            protoPath,
            url: process.env.SERVICE_A_GRPC_URL ?? 'localhost:50051',
            loader: { keepCase: false, longs: String, enums: String },
          },
        }),
      },
    ]),
  ],
  controllers: [OrdersGatewayController],
  providers: [OrdersGatewayService],
})
export class AppModule {}
