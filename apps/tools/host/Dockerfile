FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/tools/pdf-extract/package.json apps/tools/pdf-extract/
COPY apps/tools/host/package.json apps/tools/host/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/tools/pdf-extract apps/tools/pdf-extract
COPY apps/tools/host apps/tools/host
RUN pnpm --filter @lmxcloud/pdf-extract build && pnpm --filter @lmxcloud/tools-host build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/tools/pdf-extract/node_modules ./apps/tools/pdf-extract/node_modules
COPY --from=deps /app/apps/tools/host/node_modules ./apps/tools/host/node_modules
COPY --from=build /app/apps/tools/pdf-extract/dist ./apps/tools/pdf-extract/dist
COPY --from=build /app/apps/tools/pdf-extract/package.json ./apps/tools/pdf-extract/
COPY --from=build /app/apps/tools/host/dist ./apps/tools/host/dist
COPY --from=build /app/apps/tools/host/package.json ./apps/tools/host/
COPY package.json pnpm-workspace.yaml ./

EXPOSE 8080

CMD ["node", "apps/tools/host/dist/index.js"]
