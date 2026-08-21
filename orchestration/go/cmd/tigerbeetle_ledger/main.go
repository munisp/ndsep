package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	tb "github.com/tigerbeetle/tigerbeetle-go"
)

const (
	ledgerCode   uint32 = 1
	accountCode  uint16 = 1
	transferCode uint16 = 1
)

type application struct {
	client tb.Client
}

type transactionRequest struct {
	OrgID       string  `json:"org_id"`
	PenaltyID   string  `json:"penalty_id"`
	AmountUSD   float64 `json:"amount_usd"`
	Currency    string  `json:"currency"`
	Type        string  `json:"type"`
	Description string  `json:"description"`
	IssuedBy    string  `json:"issued_by"`
	Timestamp   string  `json:"timestamp"`
}

func requiredEnv(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("%s is required; TigerBeetle cannot be replaced with an in-memory ledger", name)
	}
	return value
}

func deterministicID(parts ...string) tb.Uint128 {
	hash := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	var bytes [16]byte
	copy(bytes[:], hash[:16])
	bytes[15] |= 0x01 // never permit a zero ID
	return tb.BytesToUint128(bytes)
}

func amountInCents(amount float64) (tb.Uint128, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return tb.Uint128{}, fmt.Errorf("amount_usd must be a positive finite value")
	}
	cents := math.Round(amount * 100)
	if cents > float64(^uint64(0)) {
		return tb.Uint128{}, fmt.Errorf("amount_usd exceeds supported range")
	}
	return tb.ToUint128(uint64(cents)), nil
}

func uint128ToUSD(value tb.Uint128) float64 {
	number := value.BigInt()
	asFloat, _ := new(big.Float).SetInt(number).Float64()
	return asFloat / 100.0
}

func validateCreateResults[T any](results []T, describe func(T) string) error {
	if len(results) == 0 {
		return nil
	}
	return fmt.Errorf("TigerBeetle rejected event: %s", describe(results[0]))
}

func (app *application) ensureAccount(id tb.Uint128) error {
	results, err := app.client.CreateAccounts([]tb.Account{{
		ID: id, Ledger: ledgerCode, Code: accountCode,
		Flags: tb.AccountFlags{History: true}.ToUint16(),
	}})
	if err != nil {
		return fmt.Errorf("create account: %w", err)
	}
	return validateCreateResults(results, func(result tb.CreateAccountResult) string {
		if result.Status == tb.AccountExists {
			return ""
		}
		return result.Status.String()
	})
}

func (app *application) ensureAccounts(orgID string) (tb.Uint128, tb.Uint128, error) {
	organization := deterministicID("ndsep", "org", orgID)
	treasury := deterministicID("ndsep", "treasury", "revenue")
	if err := app.ensureAccount(organization); err != nil {
		return tb.Uint128{}, tb.Uint128{}, err
	}
	if err := app.ensureAccount(treasury); err != nil {
		return tb.Uint128{}, tb.Uint128{}, err
	}
	return organization, treasury, nil
}

func (app *application) health(w http.ResponseWriter, _ *http.Request) {
	if err := app.client.Nop(); err != nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("TigerBeetle unavailable: %w", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"service": "tigerbeetle-ledger", "status": "healthy", "timestamp": time.Now().UTC(),
	})
}

func (app *application) transaction(w http.ResponseWriter, r *http.Request) {
	var request transactionRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
		return
	}
	if strings.TrimSpace(request.OrgID) == "" || strings.TrimSpace(request.PenaltyID) == "" || strings.TrimSpace(request.Type) == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("org_id, penalty_id, and type are required"))
		return
	}
	if request.Currency == "" {
		request.Currency = "USD"
	}
	if request.Currency != "USD" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("only USD is configured for this TigerBeetle ledger"))
		return
	}
	amount, err := amountInCents(request.AmountUSD)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	organization, treasury, err := app.ensureAccounts(request.OrgID)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	debit, credit := organization, treasury
	switch request.Type {
	case "penalty", "fine", "escrow":
	case "settlement", "refund":
		debit, credit = treasury, organization
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported transaction type %q", request.Type))
		return
	}
	transferID := deterministicID("ndsep", "transfer", request.OrgID, request.PenaltyID, request.Type, fmt.Sprintf("%.2f", request.AmountUSD))
	results, err := app.client.CreateTransfers([]tb.Transfer{{
		ID: transferID, DebitAccountID: debit, CreditAccountID: credit,
		Amount: amount, Ledger: ledgerCode, Code: transferCode,
	}})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("create TigerBeetle transfer: %w", err))
		return
	}
	if err := validateCreateResults(results, func(result tb.CreateTransferResult) string {
		if result.Status == tb.TransferExists {
			return ""
		}
		return result.Status.String()
	}); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"success": true, "transaction_id": transferID.String(), "ledger_entry_id": transferID.String(),
		"idempotent": len(results) > 0, "status": "posted",
	})
}

func (app *application) balance(w http.ResponseWriter, r *http.Request) {
	orgID := mux.Vars(r)["org_id"]
	if orgID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("org_id is required"))
		return
	}
	accountID := deterministicID("ndsep", "org", orgID)
	accounts, err := app.client.LookupAccounts([]tb.Uint128{accountID})
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, fmt.Errorf("lookup TigerBeetle account: %w", err))
		return
	}
	if len(accounts) != 1 {
		writeError(w, http.StatusNotFound, fmt.Errorf("no TigerBeetle account exists for organization"))
		return
	}
	account := accounts[0]
	issued := uint128ToUSD(account.DebitsPosted)
	paid := uint128ToUSD(account.CreditsPosted)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"orgId": orgID, "total_penalties_issued": issued, "total_penalties_paid": paid,
		"total_escrow_held": uint128ToUSD(account.DebitsPending), "total_refunds": 0.0,
		"net_liability": issued - paid, "currency": "USD", "lastUpdated": time.Now().UTC(),
	})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]interface{}{"success": false, "error": err.Error()})
}

func main() {
	addresses := strings.Split(requiredEnv("TIGERBEETLE_ADDRESSES"), ",")
	clusterID, err := tb.HexStringToUint128(requiredEnv("TIGERBEETLE_CLUSTER_ID"))
	if err != nil {
		log.Fatalf("invalid TIGERBEETLE_CLUSTER_ID: %v", err)
	}
	client, err := tb.NewClient(clusterID, addresses)
	if err != nil {
		log.Fatalf("create TigerBeetle client: %v", err)
	}
	defer client.Close()
	application := &application{client: client}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8240"
	}
	router := mux.NewRouter()
	router.HandleFunc("/health", application.health).Methods(http.MethodGet)
	router.HandleFunc("/transaction", application.transaction).Methods(http.MethodPost)
	router.HandleFunc("/balance/{org_id}", application.balance).Methods(http.MethodGet)
	log.Printf("TigerBeetle ledger proxy starting on :%s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatalf("TigerBeetle ledger proxy failed: %v", err)
	}
}
