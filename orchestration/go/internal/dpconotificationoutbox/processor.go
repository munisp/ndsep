package dpconotificationoutbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type DeliveryResult struct {
	ProviderDeliveryID string
	ProviderStatus     string
}

type Deliverer interface {
	Deliver(context.Context, Record) (DeliveryResult, error)
}

type PermanentDeliveryError struct {
	StatusCode int
	Message    string
}

func (e *PermanentDeliveryError) Error() string {
	return fmt.Sprintf("non-retryable notification provider failure (%d): %s", e.StatusCode, e.Message)
}

type Processor struct {
	Store          *Store
	Deliverer      Deliverer
	LeaseDuration  time.Duration
	RequestTimeout time.Duration
}

func (p Processor) DrainOnce(ctx context.Context, limit int) error {
	if p.Store == nil || p.Deliverer == nil {
		return fmt.Errorf("DPCO notification delivery processor is not configured")
	}
	if p.LeaseDuration <= 0 {
		p.LeaseDuration = 2 * time.Minute
	}
	if p.RequestTimeout <= 0 {
		p.RequestTimeout = 5 * time.Second
	}

	records, err := p.Store.Claim(ctx, limit, p.LeaseDuration)
	if err != nil {
		return err
	}
	for _, record := range records {
		requestCtx, cancel := context.WithTimeout(ctx, p.RequestTimeout)
		result, deliveryErr := p.Deliverer.Deliver(requestCtx, record)
		cancel()
		if deliveryErr == nil {
			if err := p.Store.MarkDelivered(ctx, record, result.ProviderDeliveryID, result.ProviderStatus); err != nil {
				return fmt.Errorf("acknowledge delivered DPCO notification %s: %w", record.ID, err)
			}
			continue
		}

		var permanent *PermanentDeliveryError
		if errors.As(deliveryErr, &permanent) {
			if err := p.Store.MarkDeadLetter(ctx, record, deliveryErr); err != nil {
				return fmt.Errorf("dead-letter DPCO notification %s: %w", record.ID, err)
			}
			continue
		}

		if _, err := p.Store.MarkRetry(ctx, record, retryDelay(record.Attempts), deliveryErr); err != nil {
			return fmt.Errorf("schedule DPCO notification retry %s: %w", record.ID, err)
		}
	}
	return nil
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 10 {
		attempt = 10
	}
	// Bounded exponential backoff. The lease and persistent next_attempt_at field,
	// not process memory, determine recovery after restart.
	delay := 5 * time.Second * time.Duration(1<<(attempt-1))
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}

type HTTPDeliverer struct {
	Endpoint *url.URL
	Client   *http.Client
}

func NewHTTPDeliverer(rawURL string) (*HTTPDeliverer, error) {
	endpoint, err := url.Parse(rawURL)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" {
		return nil, fmt.Errorf("DPCO notification delivery URL must be an absolute URL")
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/api/dpco/notifications/send"
	return &HTTPDeliverer{Endpoint: endpoint, Client: &http.Client{}}, nil
}

func (d *HTTPDeliverer) Deliver(ctx context.Context, record Record) (DeliveryResult, error) {
	if d == nil || d.Endpoint == nil {
		return DeliveryResult{}, fmt.Errorf("DPCO notification deliverer is not configured")
	}
	client := d.Client
	if client == nil {
		client = http.DefaultClient
	}

	body, err := json.Marshal(map[string]any{
		"rule_id":    record.RuleID,
		"entity_id":  record.EntityID,
		"event_data": json.RawMessage(record.EventData),
		"delivery_id": record.ID.String(),
	})
	if err != nil {
		return DeliveryResult{}, fmt.Errorf("encode notification delivery request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, d.Endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return DeliveryResult{}, fmt.Errorf("create notification delivery request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", record.IdempotencyKey.String())
	request.Header.Set("X-NDSEP-Delivery-ID", record.ID.String())

	response, err := client.Do(request)
	if err != nil {
		// Context deadline and transport failures are ambiguous: the provider may
		// have received the request. They remain pending for a same-key retry.
		return DeliveryResult{}, fmt.Errorf("deliver DPCO notification: %w", err)
	}
	defer response.Body.Close()

	limitedBody, readErr := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if readErr != nil {
		return DeliveryResult{}, fmt.Errorf("read DPCO notification provider response: %w", readErr)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(limitedBody))
		if message == "" {
			message = response.Status
		}
		if response.StatusCode >= http.StatusBadRequest && response.StatusCode < http.StatusInternalServerError && response.StatusCode != http.StatusRequestTimeout && response.StatusCode != http.StatusTooManyRequests {
			return DeliveryResult{}, &PermanentDeliveryError{StatusCode: response.StatusCode, Message: message}
		}
		return DeliveryResult{}, fmt.Errorf("notification provider returned status %d: %s", response.StatusCode, message)
	}

	var payload struct {
		DeliveryID string `json:"delivery_id"`
		Status     string `json:"status"`
	}
	if len(limitedBody) > 0 && json.Unmarshal(limitedBody, &payload) != nil {
		// A 2xx response is a provider acceptance only if the provider has honored
		// the forwarded idempotency key. Require that contract at deployment review.
		payload.Status = "accepted"
	}
	if payload.DeliveryID == "" {
		payload.DeliveryID = response.Header.Get("X-NDSEP-Delivery-ID")
	}
	if payload.DeliveryID == "" {
		payload.DeliveryID = record.ID.String()
	}
	if payload.Status == "" {
		payload.Status = strconv.Itoa(response.StatusCode)
	}
	return DeliveryResult{ProviderDeliveryID: payload.DeliveryID, ProviderStatus: payload.Status}, nil
}
