# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# `CMD` is retained for compatibility with existing compose files. New callers
# should pass WORKER. The build fails if neither resolves to an available worker.
ARG WORKER
ARG CMD
RUN worker="${WORKER:-${CMD:-}}"; \
    test -n "$worker"; \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
      -ldflags="-w -s -X main.Version=$(date +%Y%m%d) -X main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      -trimpath \
      -o /worker \
      "./cmd/${worker}/..."

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
# Alpine provides the `wget` probe used by the production compose health checks.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
  && adduser -D -u 65534 -H worker
COPY --from=builder /worker /worker
EXPOSE 8150
USER worker
ENTRYPOINT ["/worker"]
