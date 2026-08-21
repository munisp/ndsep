package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Client performs cache and rate-limit operations against Redis. It deliberately
// does not maintain an in-memory substitute: callers receive the Redis error and
// can apply an explicit, security-appropriate policy at their boundary.
type Client struct {
	client *goredis.Client
	logger *log.Logger
}

func New() *Client {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = "localhost:6379"
	}
	return &Client{
		client: goredis.NewClient(&goredis.Options{Addr: addr}),
		logger: log.New(os.Stdout, "[redis] ", log.LstdFlags),
	}
}

func (c *Client) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal Redis value: %w", err)
	}
	if err := c.client.Set(ctx, key, raw, ttl).Err(); err != nil {
		return fmt.Errorf("redis SET %q: %w", key, err)
	}
	return nil
}

func (c *Client) Get(ctx context.Context, key string, dest interface{}) error {
	raw, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		return fmt.Errorf("redis GET %q: %w", key, err)
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("decode Redis value %q: %w", key, err)
	}
	return nil
}

func (c *Client) Delete(ctx context.Context, key string) error {
	if err := c.client.Del(ctx, key).Err(); err != nil {
		return fmt.Errorf("redis DEL %q: %w", key, err)
	}
	return nil
}

func (c *Client) SetRiskScore(ctx context.Context, orgID string, score float64) error {
	return c.Set(ctx, fmt.Sprintf("risk_score:%s", orgID), score, 15*time.Minute)
}

func (c *Client) GetRiskScore(ctx context.Context, orgID string) (float64, error) {
	var score float64
	if err := c.Get(ctx, fmt.Sprintf("risk_score:%s", orgID), &score); err != nil {
		return 0, err
	}
	return score, nil
}

func (c *Client) SetComplianceScore(ctx context.Context, orgID string, score float64) error {
	return c.Set(ctx, fmt.Sprintf("compliance_score:%s", orgID), score, 15*time.Minute)
}

// RateLimit increments the named counter and returns false once the configured
// limit is exceeded. Redis failures are returned to callers and must never be
// normalized to an allow decision.
func (c *Client) RateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if limit < 1 || window <= 0 {
		return false, fmt.Errorf("invalid rate-limit policy")
	}
	counter := "rate_limit:" + key
	pipe := c.client.TxPipeline()
	count := pipe.Incr(ctx, counter)
	pipe.Expire(ctx, counter, window)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("redis rate limit %q: %w", key, err)
	}
	return count.Val() <= int64(limit), nil
}
