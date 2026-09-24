# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Copy go module files first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy all source
COPY . .

# Build argument: which worker to compile
# docker-compose-workers-addition.yml passes the worker name as build-arg CMD;
# docker-compose.middleware.yml passes it as WORKER. CMD wins when provided.
ARG WORKER=dapr_bridge
ARG CMD=${WORKER}

# Build the specified worker binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s -X main.Version=$(date +%Y%m%d) -X main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -trimpath \
    -o /worker \
    ./cmd/${CMD}/...

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM scratch

# Copy CA certificates for HTTPS calls
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# Copy timezone data
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
# Copy the compiled binary
COPY --from=builder /worker /worker

# Expose metrics and health port (overridden per-worker via PORT env)
EXPOSE 8150

# Run as non-root (UID 65534 = nobody)
USER 65534

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/worker", "-health-check"] || exit 1

ENTRYPOINT ["/worker"]
