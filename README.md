# grpc-monorepo-starter

Degit-able starter: **pnpm workspace + Turborepo + NestJS gRPC services + ts-proto + Buf**. One `.proto` edit produces type-safe TypeScript, Go, and Python clients.

```
proto/orders/v1/orders.proto                  ← source of truth
        │
        ▼   buf generate
┌────────────────┬─────────────────┬─────────────────┐
│ packages/      │ clients/go/pb/  │ clients/python/ │
│ proto-gen/     │   *.pb.go       │   *_pb2.py      │
└──────┬─────────┴─────────────────┴─────────────────┘
       │
   ┌───┴────────────┐
   ▼                ▼
service-a       service-b
:50051 gRPC ──► :3001 HTTP
(NestJS)        (NestJS, REST→gRPC)
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

That's two NestJS services talking gRPC. The TypeScript bindings already exist under `packages/proto-gen/src/generated/`; Go and Python clients are committed under `clients/`.

## What's wired

| Layer | Choice |
|---|---|
| Workspace | pnpm 9 + Turborepo 2 |
| Runtime | Node 22 LTS, TypeScript 5.7+ |
| HTTP / gRPC | NestJS 11 + Fastify + `@nestjs/microservices` |
| gRPC runtime | `@grpc/grpc-js` + `@grpc/proto-loader` (pure JS) |
| TS codegen | `ts-proto` (NestJS-compatible output) |
| Proto tooling | Buf — lint + breaking-change + multi-lang codegen |
| Tests | Vitest 2 — unit + live-gRPC integration (27 tests, 4 files) |
| Lint / format | Biome 1.9 |
| CI | GitHub Actions — `ci.yml` (build+test) and `proto.yml` (buf lint+breaking) |

## Repo layout

```
.
├── proto/orders/v1/orders.proto         single source of truth
├── buf.yaml + buf.gen.yaml              lint, breaking, codegen
├── packages/proto-gen/                  @repo/proto-gen — generated TS, committed
├── apps/service-a/                      NestJS gRPC server on :50051 (HTTP :3000 health)
├── apps/service-b/                      NestJS HTTP→gRPC client on :3001
├── clients/go/                          generated Go stubs + go.mod
├── clients/python/                      generated Python stubs
├── docker-compose.yml                   service-a + service-b
└── .github/workflows/                   ci.yml + proto.yml
```

## The edit-a-proto dev loop

```bash
# 1. Edit the source of truth
$EDITOR proto/orders/v1/orders.proto

# 2. Regenerate TS + Go + Python in one shot
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

## RPC surface

`orders.v1.OrdersService` ships with three RPCs:

| RPC | Shape | service-a impl | service-b REST |
|---|---|---|---|
| `CreateOrder` | unary | `OrdersStore.create` (in-memory) | `POST /orders` |
| `GetOrder` | unary | `OrdersStore.get` | `GET /orders/:id` |
| `ListOrders` | server-stream | `OrdersStore.list` → `Observable<Order>` | `GET /orders` (buffered) or `?stream=ndjson` |

Realistic message shapes — `id`, `customer_id`, `line_items[]`, `total_cents`, `currency`, `OrderStatus` enum, `created_at`. Replace the in-memory store with Postgres/Drizzle/whatever; the gRPC wiring stays the same.

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
- `@repo/service-a` — 15 tests; includes a real gRPC server boot and a `@grpc/grpc-js` client exercising all three RPCs (unary + streaming + error mapping)
- `@repo/service-b` — 7 tests; boots both apps and validates the full `HTTP → gRPC → store → gRPC → HTTP` loop, including NDJSON streaming

## License

MIT.
