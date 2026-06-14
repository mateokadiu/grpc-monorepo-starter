FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json ./
COPY apps/service-b/package.json apps/service-b/package.json
COPY packages/proto-gen/package.json packages/proto-gen/package.json
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY proto proto
COPY packages packages
COPY apps/service-b apps/service-b
RUN pnpm --filter @repo/proto-gen build && \
    pnpm --filter @repo/service-b build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/proto proto
COPY --from=build /repo/apps/service-b/package.json apps/service-b/package.json
COPY --from=build /repo/apps/service-b/dist apps/service-b/dist
COPY --from=build /repo/packages/proto-gen/package.json packages/proto-gen/package.json
COPY --from=build /repo/packages/proto-gen/dist packages/proto-gen/dist
RUN pnpm install --prod --frozen-lockfile=false
EXPOSE 3001
WORKDIR /repo/apps/service-b
CMD ["node", "dist/main.js"]
