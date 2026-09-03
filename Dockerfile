# ============================================================
# NDSEP API — multi-stage, digest-pinned production image
# The final release gate must scan the published OCI digest; this
# Dockerfile alone is not evidence that a candidate is vulnerability-free.
# ============================================================

ARG NODE_ALPINE_IMAGE=node:22-alpine3.23@sha256:46825fbbd4e996a78b7a2cdc08d75e38a5a505bdab95dcda55605359bf124bc6
ARG PNPM_VERSION=10.34.4

# ── Stage 1: build dependencies ──────────────────────────────
FROM ${NODE_ALPINE_IMAGE} AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN apk upgrade --no-cache \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# Build tooling remains in this stage only.
RUN pnpm install --frozen-lockfile --prod=false

# ── Stage 2: compile application ─────────────────────────────
FROM ${NODE_ALPINE_IMAGE} AS builder
ARG PNPM_VERSION
WORKDIR /app
RUN apk upgrade --no-cache \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# ── Stage 3: production runtime ──────────────────────────────
FROM ${NODE_ALPINE_IMAGE} AS production
ARG PNPM_VERSION
WORKDIR /app
# Keep the OS package fix in the final layer too. The release gate confirms
# actual libcrypto3/libssl3 versions and rejects unsupported OS packages.
RUN apk upgrade --no-cache \
    && addgroup -g 1001 -S ndsep \
    && adduser -S ndsep -u 1001 -G ndsep \
    && corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
# Runtime tree only: lifecycle scripts are not executed and no build stage
# node_modules, esbuild binary or source worker directories are copied here.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
    && pnpm store prune \
    && test ! -e node_modules/.pnpm/@esbuild+linux-x64@*/node_modules/@esbuild/linux-x64/bin/esbuild

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
RUN chown -R ndsep:ndsep /app

USER ndsep
ENV NODE_ENV=production PORT=3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
EXPOSE 3000
CMD ["node", "dist/index.js"]
