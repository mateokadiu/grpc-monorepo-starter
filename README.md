# grpc-monorepo-starter

Degit-able starter: **pnpm workspace + Turborepo + NestJS gRPC services + ts-proto + Buf**. One `.proto` edit produces type-safe TypeScript, browser, Go, and Python clients.

```
proto/orders/v1/orders.proto     proto/users/v1/users.proto     proto/grpc/health/v1/health.proto
        │                                │                                 │
        ▼   buf generate                 ▼                                 ▼
┌───────────────┬─────────────────┬─────────────────┬─────────────────────┐
│ packages/     │ clients/        │ clients/go/pb/  │ clients/python/     │
│ proto-gen/    │ connect-web/    │   *.pb.go       │   *_pb2.py          │
│ (ts-proto)    │ (connect-es)    │                 │                     │
└──────┬────────┴─────────────────┴─────────────────┴─────────────────────┘
       │
   ┌───┴────────────┬─────────────────┐
   ▼                ▼                 ▼
service-a       service-a-auth    service-b
:50051 gRPC ──► :50061 gRPC ────► :3001 HTTP
(NestJS,        (NestJS, JWT)     (NestJS, REST→gRPC)
 health +
 streaming)
```

## 60-second quickstart

```bash
pnpm dlx degit mateokadiu/grpc-monorepo-starter my-platform
cd my-platform
pnpm install
pnpm build
pnpm dev
```

Then, in another shell:

```bash
# create an order — REST in, gRPC out
curl -s -X POST http://localhost:3001/orders \
  -H 'content-type: application/json' \
  -d '{"customer_id":"cus_1","currency":"USD","line_items":[{"sku":"A","name":"Espresso","quantity":2,"unitPriceCents":350}]}' \
  | jq .

# read it back
curl -s http://localhost:3001/orders/<id>

# stream all orders as NDJSON (server-streaming RPC forwarded over HTTP)
curl -sN http://localhost:3001/orders?customer_id=cus_1&stream=ndjson
```

That's two NestJS services talking gRPC. The TypeScript bindings already exist under `packages/proto-gen/src/generated/`; Go and Python clients are committed under `clients/`; browser-side `connect-es` clients under `clients/connect-web/`.

## What's wired (v1.0)

| Layer | Choice |
|---|---|
| Workspace | pnpm 9 + Turborepo 2 |
| Runtime | Node 22 LTS, TypeScript 5.7+ |
| HTTP / gRPC | NestJS 11 + Fastify + `@nestjs/microservices` |
| gRPC runtime | `@grpc/grpc-js` + `@grpc/proto-loader` (pure JS) |
| TS codegen (server) | `ts-proto` (NestJS-compatible output) |
| TS codegen (browser) | `@bufbuild/protoc-gen-es` + `@connectrpc/connect-web` |
| Proto tooling | Buf — lint + breaking-change + multi-lang codegen |
| Auth recipe | JWT (jose) + `@grpc/grpc-js` Interceptor |
| Health | standard `grpc.health.v1.Health` (Check + Watch) |
| Tests | Vitest 2 — 52 tests across unit + live-gRPC integration |
| Lint / format | Biome 1.9 |
| CI | GitHub Actions — `ci.yml` (build+test) and `proto.yml` (buf lint+breaking) |

## Repo layout

```
.
├── proto/orders/v1/orders.proto             orders package
├── proto/users/v1/users.proto               users package
├── proto/grpc/health/v1/health.proto        vendored standard health proto
├── buf.yaml + buf.gen.yaml                  lint, breaking, codegen (ts / connect-es / go / python)
├── packages/proto-gen/                      @repo/proto-gen — generated TS, committed
├── apps/service-a/                          gRPC server (orders + health + streaming) on :50051
├── apps/service-a-auth/                     gRPC server with JWT interceptor on :50061
├── apps/service-b/                          NestJS HTTP→gRPC client on :3001
├── clients/go/                              generated Go stubs + go.mod
├── clients/python/                          generated Python stubs
├── clients/connect-web/                     browser bindings via connect-es
├── examples/web/                            Vite static page calling OrdersService from a browser
├── docker-compose.yml                       service-a + service-b
└── .github/workflows/                       ci.yml + proto.yml
```

## RPC surface

`orders.v1.OrdersService` ships with five RPCs spanning every gRPC streaming shape:

| RPC | Shape | service-a impl | service-b REST |
|---|---|---|---|
| `CreateOrder` | unary | `OrdersStore.create` | `POST /orders` |
| `GetOrder` | unary | `OrdersStore.get` | `GET /orders/:id` |
| `ListOrders` | server-stream | `OrdersStore.list` → `Observable<Order>` | `GET /orders` (buffered) or `?stream=ndjson` |
| `BulkCreateOrders` | client-stream | `Observable<CreateOrderRequest>` → summary | — |
| `EchoOrders` | bidirectional | per-request `Order` echo | — |

`users.v1.UsersService` ships with three RPCs (`GetUser`, `CreateUser`, `ListUsers`) demonstrating the multi-package layout — same workspace, same toolchain, second proto package.

`grpc.health.v1.Health` ships standard `Check` + `Watch` for orchestrators (k8s `grpc_health_probe`, Envoy, ALB).

## Browser clients — `clients/connect-web`

Connect-ES generates message types + service descriptors that work over the [Connect protocol](https://connectrpc.com/docs/protocol/) (HTTP/JSON over `fetch`) or gRPC-Web. No protobufjs runtime; no proxy required when paired with a Connect-aware gateway.

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

Run the demo:

```bash
pnpm --filter @example/web dev          # http://localhost:5173
```

For raw gRPC backends (this repo's `service-a`), front them with [`envoy`](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_web_filter)'s `grpc_web` filter, [`vanguard`](https://github.com/connectrpc/vanguard-go), or run [`connect-go`](https://connectrpc.com/docs/go/getting-started/) which speaks gRPC + gRPC-Web + Connect on the same port.

## Multi-package protos

Two top-level packages ship today — `orders.v1` and `users.v1` — generated independently from the same `buf.yaml` module. Add a third the same way:

```
proto/
├── orders/v1/orders.proto         package orders.v1
├── users/v1/users.proto           package users.v1
└── inventory/v1/inventory.proto   package inventory.v1   ← new
```

Run `pnpm proto:gen` and the TS / connect-es / Go / Python trees pick up the new package automatically. Imports follow the package path:

```ts
import { Order } from '@repo/proto-gen/orders/v1';
import { User } from '@repo/proto-gen/users/v1';
```

## Auth recipe — `apps/service-a-auth`

A reference NestJS gRPC server protected by a JWT interceptor:

```ts
// apps/service-a-auth/src/app.module.ts
@Module({
  controllers: [OrdersController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: JwtAuthInterceptor }],
})
export class AppModule {}
```

The server-side interceptor reads `authorization: Bearer <jwt>` from gRPC `Metadata`, verifies via `jose`, and short-circuits unauthenticated calls with `status.UNAUTHENTICATED`. Health + reflection paths bypass the check so orchestrators can probe.

For the caller side, ship a `@grpc/grpc-js` client `Interceptor` that attaches the token outbound:

```ts
import { Client, credentials } from '@grpc/grpc-js';
import { makeAuthInterceptor } from '@repo/service-a-auth/dist/auth/client-interceptor.js';

const interceptors = [makeAuthInterceptor(async () => fetchFreshJwt())];
const client = new Client('localhost:50061', credentials.createInsecure(), { interceptors });
```

Per-call token rotation (e.g. refreshing a short-lived JWT) lives in `tokenProvider`. Use the same wire format whether the caller is a NestJS `ClientsModule` consumer or a raw `@grpc/grpc-js` client.

## Standard health checks

`service-a` registers `grpc.health.v1.Health` alongside `orders.v1.OrdersService` on the same port. Probes work without an HTTP shim:

```bash
grpc_health_probe -addr localhost:50051                          # process health
grpc_health_probe -addr localhost:50051 -service orders.v1.OrdersService
```

The `HealthRegistry` injected into the controller lets app code flip serving state per-rpc-package — useful during shutdown to drain traffic before terminating:

```ts
constructor(private readonly health: HealthRegistry) {}
onModuleDestroy() {
  this.health.set('orders.v1.OrdersService', HealthCheckResponse_ServingStatus.NOT_SERVING);
}
```

`Watch` is a server-stream — clients receive transition events without polling.

## Streaming + deadlines + cancellation

Every gRPC streaming shape has an integration test under `apps/service-a/src/streaming/`:

- `server-stream.test.ts` — `for await (const o of stream)` over a server-streaming RPC, including early-`break` cleanup.
- `client-stream.test.ts` — drive `BulkCreateOrders` from any `AsyncIterable<CreateOrderRequest>`.
- `bidi.test.ts` — `EchoOrders` with interleaved writes and reads.
- `deadline-cancel.test.ts` — `DEADLINE_EXCEEDED` propagation via `Metadata` deadlines and client-side `AbortController` cancellation surfaced as `status.CANCELLED`.

## The edit-a-proto dev loop

```bash
# 1. Edit the source of truth
$EDITOR proto/orders/v1/orders.proto

# 2. Regenerate TS + connect-es + Go + Python in one shot
pnpm proto:gen        # → buf generate
# Don't have `buf` installed?  brew install bufbuild/buf/buf
# Or: pnpm dlx @bufbuild/buf generate

# 3. Typecheck + test — generated types flow through the workspace
pnpm typecheck
pnpm test

# 4. Open a PR. proto.yml runs:
#    - buf lint
#    - buf breaking --against the PR base branch
```

The generated trees are checked in. CI does not regenerate; it runs lint, breaking-change checks, build, typecheck, and tests against the committed output. This is the deliberate trade-off that keeps the `degit` experience under 60 seconds — consumers without `buf` can still build and run on first install.

## Adding a new service

```bash
cp -r apps/service-a apps/service-c
# edit apps/service-c/package.json — name + ports
# edit apps/service-c/src/main.ts — gRPC bind port
# add to docker-compose.yml
```

That's it. `@repo/proto-gen` already gives the new service the generated types and gRPC service descriptors.

## Run the full stack in Docker

```bash
pnpm compose:up        # docker compose up -d
curl http://localhost:3001/orders/ord_x
pnpm compose:down
```

## Tests

```bash
pnpm test
```

- `@repo/proto-gen` — 5 round-trip / enum / service-descriptor tests
- `@repo/connect-web` — 4 connect-es descriptor + message round-trip tests
- `@repo/service-a` — 32 tests across unary, server-stream, client-stream, bidi, health, and deadline / cancel
- `@repo/service-a-auth` — 4 JWT interceptor tests (server + client side)
- `@repo/service-b` — 7 tests; boots both apps and validates the full `HTTP → gRPC → store → gRPC → HTTP` loop, including NDJSON streaming

## License

MIT.
