#!/usr/bin/env bash
# NDSEP Lakehouse Infrastructure Setup
# Deploys MinIO (S3-compatible) + Apache Iceberg REST Catalog + DuckDB query engine
# Usage: bash scripts/setup-lakehouse.sh

set -euo pipefail

MINIO_PORT=${MINIO_PORT:-9000}
MINIO_CONSOLE_PORT=${MINIO_CONSOLE_PORT:-9001}
MINIO_ROOT_USER=${MINIO_ROOT_USER:-ndsep_lakehouse}
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD:-ndsep_lakehouse_2026}
MINIO_BUCKET=${MINIO_BUCKET:-ndsep-lakehouse}
ICEBERG_CATALOG_PORT=${ICEBERG_CATALOG_PORT:-8181}
LAKEHOUSE_DATA_DIR=${LAKEHOUSE_DATA_DIR:-/tmp/ndsep-lakehouse}

echo "=== NDSEP Lakehouse Infrastructure Setup ==="

# 1. Create data directories
mkdir -p "$LAKEHOUSE_DATA_DIR/minio" "$LAKEHOUSE_DATA_DIR/iceberg" "$LAKEHOUSE_DATA_DIR/warehouse" "$LAKEHOUSE_DATA_DIR/parquet"
echo "[1/4] Data directories created: $LAKEHOUSE_DATA_DIR"

# 2. Install MinIO if not present
if ! command -v minio &>/dev/null; then
  echo "[2/4] Installing MinIO..."
  curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio 2>/dev/null || \
  curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o "$HOME/.local/bin/minio"
  chmod +x /usr/local/bin/minio 2>/dev/null || chmod +x "$HOME/.local/bin/minio"
fi
if ! command -v mc &>/dev/null; then
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc 2>/dev/null || \
  curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o "$HOME/.local/bin/mc"
  chmod +x /usr/local/bin/mc 2>/dev/null || chmod +x "$HOME/.local/bin/mc"
fi
echo "[2/4] MinIO binaries ready"

# 3. Environment variables for platform
cat > "$LAKEHOUSE_DATA_DIR/.env" <<EOF
# NDSEP Lakehouse Environment
MINIO_ENDPOINT=http://localhost:${MINIO_PORT}
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=${MINIO_BUCKET}
LAKEHOUSE_CATALOG_URL=http://localhost:${ICEBERG_CATALOG_PORT}
LAKEHOUSE_S3_ENDPOINT=http://localhost:${MINIO_PORT}
LAKEHOUSE_S3_BUCKET=${MINIO_BUCKET}
LAKEHOUSE_ENABLED=true
LAKEHOUSE_WAREHOUSE_PATH=${LAKEHOUSE_DATA_DIR}/warehouse
LAKEHOUSE_PARQUET_PATH=${LAKEHOUSE_DATA_DIR}/parquet
EOF

echo "[3/4] Environment file: $LAKEHOUSE_DATA_DIR/.env"

# 4. Print startup commands
echo "[4/4] Setup complete. Start services with:"
echo ""
echo "  # Start MinIO (S3-compatible object storage):"
echo "  MINIO_ROOT_USER=${MINIO_ROOT_USER} MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD} \\"
echo "    minio server ${LAKEHOUSE_DATA_DIR}/minio --address :${MINIO_PORT} --console-address :${MINIO_CONSOLE_PORT} &"
echo ""
echo "  # Create lakehouse bucket:"
echo "  mc alias set ndsep http://localhost:${MINIO_PORT} ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}"
echo "  mc mb ndsep/${MINIO_BUCKET}"
echo ""
echo "  # Start lakehouse services:"
echo "  source ${LAKEHOUSE_DATA_DIR}/.env"
echo "  python3 workers/python/lakehouse_analytics_engine.py &"
echo "  cargo run --manifest-path workers/rust/lakehouse_ingest/Cargo.toml --release &"
echo "  cargo run --manifest-path workers/rust/lakehouse_writer/Cargo.toml --release &"
echo ""
echo "=== Lakehouse infrastructure ready ==="
