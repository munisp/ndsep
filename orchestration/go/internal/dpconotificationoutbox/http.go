package dpconotificationoutbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

type Principal struct {
	TenantID string
	ActorID  string
}

type PrincipalResolver func(context.Context, *http.Request) (Principal, error)

type MutationHandler struct {
	Store            *Store
	ResolvePrincipal PrincipalResolver
}

type mutationInput struct {
	RuleID    string          `json:"rule_id"`
	EntityID  string          `json:"entity_id"`
	EventData json.RawMessage `json:"event_data"`
}

type mutationResponse struct {
	DeliveryID       uuid.UUID `json:"delivery_id"`
	IdempotencyKey   uuid.UUID `json:"idempotency_key"`
	Status           string    `json:"status"`
	Reused           bool      `json:"reused"`
	ProviderStatus   *string   `json:"provider_status,omitempty"`
	ProviderDelivery *string   `json:"provider_delivery_id,omitempty"`
}

func (h MutationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if h.Store == nil || h.ResolvePrincipal == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "durable DPCO notification outbox is unavailable")
		return
	}
	principal, err := h.ResolvePrincipal(r.Context(), r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "notification identity is unavailable")
		return
	}
	key, err := uuid.Parse(strings.TrimSpace(r.Header.Get("Idempotency-Key")))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Idempotency-Key must be a UUID")
		return
	}

	var input mutationInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid notification request")
		return
	}
	if strings.TrimSpace(input.RuleID) == "" || strings.TrimSpace(input.EntityID) == "" {
		writeJSONError(w, http.StatusBadRequest, "rule_id and entity_id are required")
		return
	}
	if len(input.EventData) == 0 {
		input.EventData = json.RawMessage(`{}`)
	}

	record, reused, err := h.Store.Enqueue(r.Context(), Intent{
		TenantID:       principal.TenantID,
		ActorID:        principal.ActorID,
		IdempotencyKey: key,
		RuleID:         input.RuleID,
		EntityID:       input.EntityID,
		EventData:      input.EventData,
	})
	var conflict *IdempotencyConflictError
	if errors.As(err, &conflict) {
		writeJSONError(w, http.StatusConflict, conflict.Error())
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "notification intent could not be durably recorded")
		return
	}

	writeJSON(w, http.StatusAccepted, mutationResponse{
		DeliveryID:       record.ID,
		IdempotencyKey:   record.IdempotencyKey,
		Status:           record.Status,
		Reused:           reused,
		ProviderStatus:   record.ProviderStatus,
		ProviderDelivery: record.ProviderDeliveryID,
	})
}

func (h MutationHandler) DeliveryStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONError(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	if h.Store == nil || h.ResolvePrincipal == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "durable DPCO notification outbox is unavailable")
		return
	}
	principal, err := h.ResolvePrincipal(r.Context(), r)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "notification identity is unavailable")
		return
	}
	key, err := uuid.Parse(strings.TrimSpace(r.PathValue("idempotencyKey")))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "idempotency key must be a UUID")
		return
	}
	record, err := h.Store.GetByIdempotencyKey(r.Context(), principal.TenantID, key)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSONError(w, http.StatusNotFound, "notification delivery was not found")
		return
	}
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "notification delivery status is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, mutationResponse{
		DeliveryID:       record.ID,
		IdempotencyKey:   record.IdempotencyKey,
		Status:           record.Status,
		Reused:           true,
		ProviderStatus:   record.ProviderStatus,
		ProviderDelivery: record.ProviderDeliveryID,
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

