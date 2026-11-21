# ---------------------------------------------------------------------------
# KotaLabs CRM backend — production image
# Multi-stage: install -> build -> slim runtime (no devDependencies).
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
COPY apps/backend/package.json apps/backend/package-lock.json* ./
RUN npm install --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json ./
COPY apps/backend/src ./src
RUN npm run build && npm prune --production

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user.
RUN addgroup -S crm && adduser -S crm -G crm

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY apps/backend/migrations ./migrations
COPY apps/backend/scripts ./scripts

USER crm
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["node", "dist/server.js"]
