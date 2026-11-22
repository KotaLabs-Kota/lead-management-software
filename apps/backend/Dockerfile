# ---------------------------------------------------------------------------
# KotaLabs CRM backend — production image
# Multi-stage: install -> build -> slim runtime (no devDependencies).
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
# Use the workspace lockfile for reproducible, audited dependency versions.
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @kotalabs/backend --include-workspace-root=false --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app ./
COPY apps/backend/tsconfig.json apps/backend/tsconfig.build.json ./apps/backend/
COPY apps/backend/src ./apps/backend/src
RUN npm run build --workspace @kotalabs/backend && \
    npm prune --workspace @kotalabs/backend --include-workspace-root=false --omit=dev --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user.
RUN addgroup -S crm && adduser -S crm -G crm

COPY --from=build /app/apps/backend/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/backend/package.json ./package.json
COPY apps/backend/migrations ./migrations
COPY apps/backend/scripts ./scripts

USER crm
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1

CMD ["node", "dist/server.js"]
