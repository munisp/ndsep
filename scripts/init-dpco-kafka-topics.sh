#!/bin/bash
# Initialize DPCO Kafka topics
# Run: docker exec kafka bash /scripts/init-dpco-kafka-topics.sh
set -e
KAFKA_BIN=${KAFKA_BIN:-/opt/kafka/bin}
BOOTSTRAP=${BOOTSTRAP_SERVERS:-localhost:9092}

TOPICS=(
  "ndsep.dpco.audit.events"
  "ndsep.dpco.registry.events"
  "ndsep.dpco.verification.events"
  "ndsep.dpco.analytics.events"
  "ndsep.dpco.notifications.sent"
)

for TOPIC in "${TOPICS[@]}"; do
  echo "Creating topic: $TOPIC"
  $KAFKA_BIN/kafka-topics.sh \
    --bootstrap-server "$BOOTSTRAP" \
    --create \
    --if-not-exists \
    --topic "$TOPIC" \
    --partitions 6 \
    --replication-factor 1 \
    --config retention.ms=604800000 \
    --config compression.type=snappy \
    --config min.insync.replicas=1
  echo "  ✓ $TOPIC"
done

echo "All DPCO Kafka topics initialized."
