# `@example/web` — browser fetch demo

A static HTML page that calls `OrdersService` from the browser, using
`@repo/connect-web` (generated via `@bufbuild/protoc-gen-es`) and
`@connectrpc/connect-web` over `fetch`.

## Run it

```bash
pnpm --filter @example/web dev
# open http://localhost:5173
```

The page expects a **Connect-protocol** endpoint at the configured Base
URL. The reference `service-a` in this repo speaks raw gRPC over HTTP/2;
to bridge it to the browser you need one of:

- [`envoy`](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_web_filter) with the `grpc_web` filter
- [`connect-go`](https://connectrpc.com/docs/go/getting-started/) running the same `.proto` natively (speaks gRPC + gRPC-Web + Connect on the same port)
- [`vanguard`](https://github.com/connectrpc/vanguard-go) — a stateless proxy that translates Connect/gRPC-Web ⇄ gRPC

For local hacking, the simplest path is `vanguard -addr :8080 -upstream localhost:50051`.

## Code shape

```ts
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { OrdersService } from '@repo/connect-web/orders/v1';

const transport = createConnectTransport({ baseUrl: 'http://localhost:8080' });
const client = createClient(OrdersService, transport);

const { order } = await client.getOrder({ id: 'ord_demo_1' });
for await (const o of client.listOrders({ customerId: 'cus_1', limit: 0 })) {
  console.log(o);
}
```

Type-safe at the call site; same proto contract as the Node services.
