package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/mux"
	tb "github.com/tigerbeetle/tigerbeetle-go"
)

const (
	usdLedgerCode uint32 = 1
	ngnLedgerCode uint32 = 2
	accountCode   uint16 = 1
	transferCode  uint16 = 1
)

type application struct {
	client tb.Client
}

type transactionRequest struct {
	OrgID           string      `json:"org_id"`
	PenaltyID       string      `json:"penalty_id"`
	Amount          json.Number `json:"amount"`
	AmountUSD       json.Number `json:"amount_usd"` // legacy name accepted only for a safe migration path
	Currency        string      `json:"currency"`
	Type            string      `json:"type"`
	DebitAccountID  string      `json:"debit_account_id"`
	CreditAccountID string      `json:"credit_account_id"`
	Description     string      `json:"description"`
	IssuedBy        string      `json:"issued_by"`
	Timestamp       string      `json:"timestamp"`
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

func configuredLedger(currency string) (uint32, string, error) {
	switch normalized := strings.ToUpper(strings.TrimSpace(currency)); normalized {
	case "USD":
		return usdLedgerCode, normalized, nil
	case "NGN":
		return ngnLedgerCode, normalized, nil
	default:
		return 0, "", fmt.Errorf("unsupported currency %q; only NGN and USD are configured", currency)
	}
}

func validateExternalID(name, value string) error {
	if len(value) == 0 || len(value) > 128 {
		return fmt.Errorf("%s must contain 1 to 128 characters", name)
	}
	for _, character := range []byte(value) {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '.' || character == '_' || character == ':' || character == '-') {
			return fmt.Errorf("%s contains an unsupported character", name)
		}
	}
	return nil
}

// amountInMinorUnits accepts a JSON decimal without exponent notation and converts
// it exactly to kobo/cents. Floating point values are never used for ledger amounts.
func amountInMinorUnits(value json.Number) (tb.Uint128, string, error) {
	raw := strings.TrimSpace(value.String())
	if raw == "" || strings.HasPrefix(raw, "-") || strings.HasPrefix(raw, "+") || strings.ContainsAny(raw, "eE") {
		return tb.Uint128{}, "", fmt.Errorf("amount must be a positive decimal with at most two fractional digits")
	}
	parts := strings.Split(raw, ".")
	if len(parts) > 2 || parts[0] == "" {
		return tb.Uint128{}, "", fmt.Errorf("amount must be a positive decimal with at most two fractional digits")
	}
	whole := parts[0]
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
		if len(fraction) > 2 {
			return tb.Uint128{}, "", fmt.Errorf("amount cannot include more than two fractional digits")
		}
	}
	for _, part := range []string{whole, fraction} {
		for _, character := range []byte(part) {
			if character < '0' || character > '9' {
				return tb.Uint128{}, "", fmt.Errorf("amount must contain decimal digits only")
			}
		}
	}
	fraction += strings.Repeat("0", 2-len(fraction))
	minor, ok := new(big.Int).SetString(strings.TrimLeft(whole+fraction, "0"), 10)
	if !ok {
		return tb.Uint128{}, "", fmt.Errorf("amount cannot be parsed")
	}
	if minor.Sign() <= 0 {
		return tb.Uint128{}, "", fmt.Errorf("amount must be greater than zero")
	}
	if minor.BitLen() > 128 {
		return tb.Uint128{}, "", fmt.Errorf("amount exceeds TigerBeetle's unsigned 128-bit range")
	}
	return tb.BigIntToUint128(minor), minor.String(), nil
}

func uint128ToDecimal(value tb.Uint128) string {
	minor := value.BigInt()
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(minor, big.NewInt(100), remainder)
	return fmt.Sprintf("%s.%02d", quotient.String(), remainder.Uint64())
}

func signedMinorToDecimal(minor *big.Int) string {
	if minor.Sign() >= 0 {
		return uint128ToDecimal(tb.BigIntToUint128(minor))
	}
	absolute := new(big.Int).Abs(minor)
	return "-" + uint128ToDecimal(tb.BigIntToUint128(absolute))
}

func validateCreateResults[T any](results []T, describe func(T) string) error {
	for _, result := range results {
		if detail := describe(result); detail != "" {
			return fmt.Errorf("TigerBeetle rejected event: %s", detail)
		}
	}
	return nil
}

func (app *application) ensureAccount(id tb.Uint128, ledger uint32) error {
	results, err := app.client.CreateAccounts([]tb.Account{{
		ID: id, Ledger: ledger, Code: accountCode,
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

func (app *application) ensureAccounts(orgID string, ledger uint32, currency string) (tb.Uint128, tb.Uint128, error) {
	organization := deterministicID("ndsep", "org", currency, orgID)
	treasury := deterministicID("ndsep", "treasury", currency, "revenue")
	if err := app.ensureAccount(organization, ledger); err != nil {
		return tb.Uint128{}, tb.Uint128{}, err
	}
	if err := app.ensureAccount(treasury, ledger); err != nil {
		return tb.Uint128{}, tb.Uint128{}, err
	}
	return organization, treasury, nil
}

func requestAmount(request transactionRequest) (json.Number, error) {
	if request.Amount != "" && request.AmountUSD != "" {
		return "", fmt.Errorf("provide either amount or amount_usd, not both")
	}
	if request.Amount != "" {
		return request.Amount, nil
	}
	if request.AmountUSD != "" {
		return request.AmountUSD, nil
	}
	return "", fmt.Errorf("amount is required")
}

func transferIDForRequest(request transactionRequest, amountMinor string, currency string, idempotencyKey string) (tb.Uint128, error) {
	if idempotencyKey != "" {
		if len(idempotencyKey) != 64 {
			return tb.Uint128{}, fmt.Errorf("Idempotency-Key must be a 64-character SHA-256 hex value")
		}
		for _, character := range []byte(idempotencyKey) {
			if !(character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F') {
				return tb.Uint128{}, fmt.Errorf("Idempotency-Key must be a 64-character SHA-256 hex value")
			}
		}
		return deterministicID("ndsep", "idempotency", strings.ToLower(idempotencyKey)), nil
	}
	return deterministicID("ndsep", "transfer", request.OrgID, request.PenaltyID, request.Type, currency, amountMinor, request.DebitAccountID, request.CreditAccountID), nil
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
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
		return
	}
	request.OrgID = strings.TrimSpace(request.OrgID)
	request.PenaltyID = strings.TrimSpace(request.PenaltyID)
	request.Type = strings.TrimSpace(request.Type)
	if err := validateExternalID("org_id", request.OrgID); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := validateExternalID("penalty_id", request.PenaltyID); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if request.Type == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("type is required"))
		return
	}
	ledger, currency, err := configuredLedger(request.Currency)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	decimal, err := requestAmount(request)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	amount, amountMinor, err := amountInMinorUnits(decimal)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if request.Timestamp != "" {
		if _, err := time.Parse(time.RFC3339, request.Timestamp); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("timestamp must use RFC 3339 format"))
			return
		}
	}

	organization, treasury, err := app.ensureAccounts(request.OrgID, ledger, currency)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err)
		return
	}
	debit, credit := organization, treasury
	switch request.Type {
	case "penalty", "fine", "escrow":
	case "settlement", "refund":
		debit, credit = treasury, organization
	case "transfer":
		if err := validateExternalID("debit_account_id", request.DebitAccountID); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := validateExternalID("credit_account_id", request.CreditAccountID); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		debit = deterministicID("ndsep", "account", currency, request.DebitAccountID)
		credit = deterministicID("ndsep", "account", currency, request.CreditAccountID)
		if err := app.ensureAccount(debit, ledger); err != nil {
			writeError(w, http.StatusServiceUnavailable, err)
			return
		}
		if err := app.ensureAccount(credit, ledger); err != nil {
			writeError(w, http.StatusServiceUnavailable, err)
			return
		}
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported transaction type %q", request.Type))
		return
	}
	transferID, err := transferIDForRequest(request, amountMinor, currency, strings.TrimSpace(r.Header.Get("Idempotency-Key")))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	results, err := app.client.CreateTransfers([]tb.Transfer{{
		ID: transferID, DebitAccountID: debit, CreditAccountID: credit,
		Amount: amount, Ledger: ledger, Code: transferCode,
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
		"idempotent": len(results) > 0, "status": "posted", "currency": currency, "amount_minor": amountMinor,
	})
}

func (app *application) balance(w http.ResponseWriter, r *http.Request) {
	orgID := mux.Vars(r)["org_id"]
	if err := validateExternalID("org_id", orgID); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	_, currency, err := configuredLedger(r.URL.Query().Get("currency"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	accountID := deterministicID("ndsep", "org", currency, orgID)
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
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"org_id":          orgID,
		"currency":        currency,
		"debits_posted":   uint128ToDecimal(account.DebitsPosted),
		"credits_posted":  uint128ToDecimal(account.CreditsPosted),
		"debits_pending":  uint128ToDecimal(account.DebitsPending),
		"credits_pending": uint128ToDecimal(account.CreditsPending),
		"net_position":    signedMinorToDecimal(new(big.Int).Sub(account.CreditsPosted.BigInt(), account.DebitsPosted.BigInt())),
		"last_updated":    time.Now().UTC(),
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
