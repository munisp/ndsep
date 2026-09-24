# NOC AI Action Engine — executes remediation plans from the reasoning engine.
# Image for the noc-ai-action Deployment (infra/k8s/noc-ai-agents.yaml) and for
# the k8sReadiness check (server/k8sReadiness.ts).
#
# Build context must be workers/go (the Go module root):
#   docker build -f cmd/noc_agent_action/Dockerfile -t ndsep/noc-ai-action:latest .
#
# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Copy go module files first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy all source
COPY . .

# Build the noc_agent_action binary with optimizations
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
    -ldflags="-w -s -X main.Version=$(date +%Y%m%d) -X main.BuildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -trimpath \
    -o /worker \
    ./cmd/noc_agent_action/...

# ─── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM scratch

# Copy CA certificates for HTTPS calls
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
# Copy timezone data
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
# Copy the compiled binary
COPY --from=builder /worker /worker

# AI Action Engine listens on the fixed port 8196 (see main.go); this matches
# the noc-ai-action k8s Service. Health is probed by the k8s liveness/readiness
# httpGet probes on /health (the binary has no -health-check flag).
EXPOSE 8196

# Run as non-root (UID 65534 = nobody)
USER 65534

ENTRYPOINT ["/worker"]
