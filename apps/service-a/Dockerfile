FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/service-a/package.json apps/service-a/package.json
COPY packages/proto-gen/package.json packages/proto-gen/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY proto proto
COPY packages packages
COPY apps/service-a apps/service-a
RUN pnpm --filter @repo/proto-gen build && \
    pnpm --filter @repo/service-a build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/proto proto
COPY --from=build /repo/apps/service-a/package.json apps/service-a/package.json
COPY --from=build /repo/apps/service-a/dist apps/service-a/dist
COPY --from=build /repo/packages/proto-gen/package.json packages/proto-gen/package.json
COPY --from=build /repo/packages/proto-gen/dist packages/proto-gen/dist
RUN pnpm install --prod --frozen-lockfile=false
EXPOSE 3000 50051
WORKDIR /repo/apps/service-a
CMD ["node", "dist/main.js"]
