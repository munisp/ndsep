FROM rust:1.78-slim-bookworm AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libpcap-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY shared ./shared
COPY wiredigg ./wiredigg
RUN cargo build --release -p wiredigg

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libpcap0.8 ca-certificates curl && rm -rf /var/lib/apt/lists/* \
    && groupadd -r wiredigg && useradd -r -g wiredigg wiredigg
COPY --from=builder /app/target/release/wiredigg /usr/local/bin/wiredigg
ENV WIREDIGG_PORT=8160
EXPOSE 8160
HEALTHCHECK --interval=15s --timeout=3s CMD curl -sf http://localhost:8160/health || exit 1
USER wiredigg
ENTRYPOINT ["wiredigg"]
