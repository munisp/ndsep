# NOC AI Perception Engine (noc_agent_perception) — anomaly/feature perception
# layer feeding the reasoning engine. Image for the noc-ai-perception
# Deployment (infra/k8s/noc-ai-agents.yaml).
#
# Build context must be the Rust workspace root (workers/rust) because the
# crate is a workspace member:
#   docker build -f noc_agent_perception/Dockerfile -t ndsep/noc-ai-perception:latest .
#
# The whole workspace is copied because cargo requires every workspace
# member's Cargo.toml to be present to resolve the build.
FROM rust:1.78-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --release -p noc_agent_perception

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -r ndsep && useradd -r -g ndsep ndsep
COPY --from=builder /app/target/release/noc_agent_perception /usr/local/bin/noc_agent_perception
# Perception engine listens on the fixed port 8194 (see src/main.rs), matching
# the noc-ai-perception k8s Service.
EXPOSE 8194
HEALTHCHECK --interval=15s --timeout=3s CMD curl -sf http://localhost:8194/health || exit 1
USER ndsep
ENTRYPOINT ["noc_agent_perception"]
