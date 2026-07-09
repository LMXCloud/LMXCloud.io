FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-server/package.json apps/mcp-server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/mcp-server apps/mcp-server
RUN pnpm --filter @lmxcloud/mcp-server build

FROM base AS runner
ENV NODE_ENV=production
ENV LMX_MCP_TRANSPORT=http
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/mcp-server/node_modules ./apps/mcp-server/node_modules
COPY --from=build /app/apps/mcp-server/dist ./apps/mcp-server/dist
COPY --from=build /app/apps/mcp-server/package.json ./apps/mcp-server/
COPY package.json pnpm-workspace.yaml ./

EXPOSE 3334

CMD ["node", "apps/mcp-server/dist/index.js"]
