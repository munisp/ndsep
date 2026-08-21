# ─── Stage 1: Chef (dependency caching) ──────────────────────────────────────
FROM lukemathwalker/cargo-chef:latest-rust-1.75-alpine AS chef
WORKDIR /build

# ─── Stage 2: Planner ────────────────────────────────────────────────────────
FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ─── Stage 3: Builder ────────────────────────────────────────────────────────
FROM chef AS builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

COPY --from=planner /build/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Build argument: which workspace member to compile
ARG SERVICE=pqc-engine

COPY . .

RUN cargo build --release --bin ${SERVICE} 2>&1 && \
    cp target/release/${SERVICE} /service

# ─── Stage 4: Runtime ────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata libgcc

COPY --from=builder /service /service

EXPOSE 8220

RUN addgroup -S ndsep && adduser -S ndsep -G ndsep
USER ndsep

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-8220}/health || exit 1

ENTRYPOINT ["/service"]
