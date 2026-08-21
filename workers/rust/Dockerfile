# ─── Stage 1: Chef (dependency caching) ──────────────────────────────────────
FROM lukemathwalker/cargo-chef:latest-rust-1.75-alpine AS chef
WORKDIR /build

# ─── Stage 2: Planner ────────────────────────────────────────────────────────
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ─── Stage 3: Builder ────────────────────────────────────────────────────────
FROM chef AS builder

# Install build dependencies
RUN apk add --no-cache musl-dev openssl-dev pkgconfig

# Cache dependencies
COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Build argument: which workspace member to compile
ARG WORKER=tigerbeetle_ledger

# Copy all source
COPY . .

# Build the specified worker with release optimizations
RUN cargo build --release --bin ${WORKER} 2>&1 && \
    cp target/release/${WORKER} /worker

# ─── Stage 4: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata libgcc

# Copy the compiled binary
COPY --from=builder /worker /worker

# Expose default port
EXPOSE 8160

# Run as non-root
RUN addgroup -S ndsep && adduser -S ndsep -G ndsep
USER ndsep

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8160}/health || exit 1

ENTRYPOINT ["/worker"]
