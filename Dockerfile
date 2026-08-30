# ============================================================
# NDSEP API — Multi-stage Production Dockerfile
# ============================================================

# ── Stage 1: Dependencies ────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 2: Build ───────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# ── Stage 3: Production ──────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S ndsep && adduser -S ndsep -u 1001 -G ndsep

# Install production-only dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && pnpm store prune

# Copy the actual Vite/esbuild output. Vite writes browser assets beneath
# dist/public and esbuild writes the Node entry point to dist/index.js.
COPY --from=builder /app/dist ./dist

# Retain schema files for explicit migration tooling. Go and Python workers are
# independently built and deployed by docker-compose.production.yml; they do
# not belong in the Node.js API image.
COPY --from=builder /app/drizzle ./drizzle

# Security: set ownership
RUN chown -R ndsep:ndsep /app

USER ndsep

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
