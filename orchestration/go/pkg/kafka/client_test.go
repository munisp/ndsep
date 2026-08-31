package kafka

import (
	"strings"
	"testing"
)

func TestValidateTopicRequiresNDSEPAllowList(t *testing.T) {
	if err := validateTopic(TopicAuditTrail); err != nil {
		t.Fatalf("allow-listed topic rejected: %v", err)
	}
	if err := validateTopic("ndsep.unapproved.topic"); err == nil {
		t.Fatal("unapproved topic was accepted")
	}
}

func TestKafkaDisabledByDefault(t *testing.T) {
	t.Setenv("APP_ENV", "test")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("KAFKA_ENABLED", "false")
	t.Setenv("KAFKA_BROKERS", "broker.internal:9093")
	client := New()
	if _, err := client.config(); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("disabled Kafka error = %v, want disabled configuration error", err)
	}
}

func TestProductionKafkaRequiresTLSAndSASL(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("KAFKA_ENABLED", "true")
	t.Setenv("KAFKA_BROKERS", "broker.internal:9093")
	t.Setenv("KAFKA_TLS_ENABLED", "false")
	t.Setenv("KAFKA_SASL_USERNAME", "")
	t.Setenv("KAFKA_SASL_PASSWORD", "")
	client := New()
	if _, err := client.config(); err == nil || !strings.Contains(err.Error(), "KAFKA_TLS_ENABLED") {
		t.Fatalf("production TLS error = %v, want TLS configuration error", err)
	}

	t.Setenv("KAFKA_TLS_ENABLED", "true")
	if _, err := client.config(); err == nil || !strings.Contains(err.Error(), "KAFKA_SASL_USERNAME") {
		t.Fatalf("production SASL error = %v, want SASL configuration error", err)
	}

	t.Setenv("KAFKA_SASL_USERNAME", "ndsep-producer")
	t.Setenv("KAFKA_SASL_PASSWORD", "test-password")
	config, err := client.config()
	if err != nil {
		t.Fatalf("secure production config rejected: %v", err)
	}
	if !config.Net.TLS.Enable || !config.Net.SASL.Enable || !config.Producer.Idempotent || config.Producer.RequiredAcks != -1 {
		t.Fatalf("secure config misses required reliability/security controls: %#v", config)
	}
}
