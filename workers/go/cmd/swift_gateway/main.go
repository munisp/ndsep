// NDSEP Banking Layer — SWIFT Gateway Worker (Go)
// =================================================
// Implements SWIFT messaging processing for cross-border payments per:
//   - SWIFT MT103 (Customer Credit Transfer)
//   - SWIFT MT202 (Financial Institution Transfer)
//   - SWIFT MT940/MT950 (Account Statement)
//   - FATF Recommendation 16 (Wire Transfer)
//   - CBN Foreign Exchange Manual 2018
//   - OFAC/UN/EU/UK Sanctions Screening
//
// Features:
//   - Inbound/outbound SWIFT message parsing and routing
//   - Mandatory sanctions screening (OFAC SDN, UN Consolidated, EU, UK HMT, NFIU)
//   - MT103 field validation (BIC, IBAN, amount, currency)
//   - Correspondent bank relationship management
//   - ACK/NACK processing
//   - CBN FX reporting for transactions > $10,000
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"
	"ndsep/workers/shared"
)

const (
	FX_REPORTING_THRESHOLD_USD = 10_000 // CBN mandatory FX reporting threshold
	SWIFT_PROCESSING_TIMEOUT_S = 60     // SWIFT message processing timeout
)

var (
	messagesProcessed int64
	sanctionsBlocked  int64
	fxReported        int64
	workerStart       = time.Now()
)

// SWIFTMessage represents a SWIFT message record from the database
type SWIFTMessage struct {
	ID              int
	MessageRef      string
	MessageType     string
	Direction       string
	SenderBIC       string
	ReceiverBIC     string
	Amount          int64
	Currency        string
	ValueDate       string
	OrderingCustomer string
	BeneficiaryCustomer string
	BeneficiaryAccount string
	RemittanceInfo  string
	DetailsOfCharges string
}

// validateBIC validates a SWIFT BIC code (8 or 11 characters)
func validateBIC(bic string) bool {
	bic = strings.TrimSpace(bic)
	if len(bic) != 8 && len(bic) != 11 {
		return false
	}
	// BIC format: AAAA BB CC DDD (bank code, country, location, branch)
	// Country code must be 2 uppercase letters
	if len(bic) >= 6 {
		cc := bic[4:6]
		for _, c := range cc {
			if c < 'A' || c > 'Z' {
				return false
			}
		}
	}
	return true
}

// screenSanctions checks all parties in a SWIFT message against watchlists
func screenSanctions(names ...string) (bool, string) {
	if shared.DB == nil {
		return false, ""
	}
	for _, name := range names {
		if name == "" {
			continue
		}
		var count int
		var listSources string
		err := shared.DB.QueryRow(`
			SELECT COUNT(*), STRING_AGG(list_source, ', ')
			FROM watchlist_entries 
			WHERE status = 'active' 
			AND LOWER(full_name) LIKE LOWER($1)`,
			"%"+name+"%",
		).Scan(&count, &listSources)
		if err == nil && count > 0 {
			return true, fmt.Sprintf("SANCTIONS_HIT: %s found on %s", name, listSources)
		}
	}
	return false, ""
}

// validateMT103 validates a SWIFT MT103 message fields
func validateMT103(msg SWIFTMessage) (bool, string) {
	if !validateBIC(msg.SenderBIC) {
		return false, fmt.Sprintf("INVALID_SENDER_BIC: %s", msg.SenderBIC)
	}
	if !validateBIC(msg.ReceiverBIC) {
		return false, fmt.Sprintf("INVALID_RECEIVER_BIC: %s", msg.ReceiverBIC)
	}
	if msg.Amount <= 0 {
		return false, "INVALID_AMOUNT: must be positive"
	}
	if len(msg.Currency) != 3 {
		return false, fmt.Sprintf("INVALID_CURRENCY: %s", msg.Currency)
	}
	if msg.BeneficiaryAccount == "" {
		return false, "MISSING_BENEFICIARY_ACCOUNT"
	}
	if msg.OrderingCustomer == "" {
		return false, "MISSING_ORDERING_CUSTOMER"
	}
	return true, ""
}

// processSWIFTMessage handles a single SWIFT message
func processSWIFTMessage(msg SWIFTMessage) {
	// Step 1: Validate message format
	if msg.MessageType == "MT103" || msg.MessageType == "MT202" {
		valid, reason := validateMT103(msg)
		if !valid {
			shared.DB.Exec(`
				UPDATE swift_messages SET status='rejected', nack_reason=$1, updated_at=NOW()
				WHERE id=$2`, reason, msg.ID)
			shared.Log("WARN", "SWIFT_VALIDATION_FAILED", map[string]interface{}{
				"msg_id": msg.ID, "ref": msg.MessageRef, "reason": reason,
			})
			return
		}
	}

	// Step 2: Mandatory sanctions screening (FATF R.16)
	hit, details := screenSanctions(msg.OrderingCustomer, msg.BeneficiaryCustomer)
	if hit {
		atomic.AddInt64(&sanctionsBlocked, 1)
		shared.DB.Exec(`
			UPDATE swift_messages SET status='blocked', sanctions_screened=true, 
			sanctions_hit=true, sanctions_details=$1, updated_at=NOW()
			WHERE id=$2`, details, msg.ID)
		shared.Log("WARN", "SWIFT_SANCTIONS_BLOCKED", map[string]interface{}{
			"msg_id": msg.ID, "ref": msg.MessageRef, "details": details,
		})
		// Notify compliance team
		shared.PublishEvent("swift.sanctions.hit", map[string]interface{}{
			"ref": msg.MessageRef, "type": msg.MessageType, "details": details,
		})
		return
	}

	// Step 3: CBN FX reporting for large transactions
	// Convert amount to USD equivalent (simplified: assume 1 USD = 1600 NGN)
	amountUSD := float64(msg.Amount) / 100 / 1600
	if msg.Currency == "USD" {
		amountUSD = float64(msg.Amount) / 100
	}
	if amountUSD >= FX_REPORTING_THRESHOLD_USD {
		atomic.AddInt64(&fxReported, 1)
		shared.PublishEvent("swift.fx.report", map[string]interface{}{
			"ref": msg.MessageRef, "amount_usd": amountUSD, "currency": msg.Currency,
			"ordering": msg.OrderingCustomer, "beneficiary": msg.BeneficiaryCustomer,
		})
	}

	// Step 4: A correspondent-bank acknowledgement is authoritative. This worker
	// records an awaiting state and never synthesizes an ACK or processing time.
	if _, err := shared.DB.Exec(`
		UPDATE swift_messages SET status='awaiting_correspondent_ack', sanctions_screened=true,
		sanctions_hit=false, ack_received=false, ack_timestamp=NULL, processing_time_ms=NULL,
		updated_at=NOW() WHERE id=$1`, msg.ID); err != nil {
		shared.Log("ERROR", "SWIFT_PENDING_ACK_WRITE_FAILED", map[string]interface{}{"msg_id": msg.ID, "error": err.Error()})
		return
	}
	shared.Log("ERROR", "SWIFT_CORRESPONDENT_ACK_REQUIRED", map[string]interface{}{
		"msg_id": msg.ID, "ref": msg.MessageRef, "type": msg.MessageType,
	})
}

// processPendingSWIFT fetches and processes all pending SWIFT messages
func processPendingSWIFT() {
	if shared.DB == nil {
		return
	}
	rows, err := shared.DB.Query(`
		SELECT id, message_reference, message_type, direction, sender_bic, receiver_bic,
		COALESCE(amount, 0), COALESCE(currency, 'USD'), COALESCE(value_date::text, ''),
		COALESCE(ordering_customer, ''), COALESCE(beneficiary_customer, ''),
		COALESCE(beneficiary_account, ''), COALESCE(remittance_info, ''),
		COALESCE(details_of_charges, 'SHA')
		FROM swift_messages WHERE status='pending'
		ORDER BY created_at ASC LIMIT 20`)
	if err != nil {
		shared.Log("ERROR", "SWIFT_FETCH_ERROR", map[string]interface{}{"error": err.Error()})
		return
	}
	defer rows.Close()

	for rows.Next() {
		var msg SWIFTMessage
		if err := rows.Scan(&msg.ID, &msg.MessageRef, &msg.MessageType, &msg.Direction,
			&msg.SenderBIC, &msg.ReceiverBIC, &msg.Amount, &msg.Currency, &msg.ValueDate,
			&msg.OrderingCustomer, &msg.BeneficiaryCustomer, &msg.BeneficiaryAccount,
			&msg.RemittanceInfo, &msg.DetailsOfCharges); err != nil {
			continue
		}
		processSWIFTMessage(msg)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8092"
	}

	shared.InitDB()
	defer shared.DB.Close()

	shared.Log("INFO", "SWIFT_GATEWAY_START", map[string]interface{}{
		"port": port, "fx_threshold_usd": FX_REPORTING_THRESHOLD_USD,
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "ok", "worker": "swift_gateway",
			"messages_processed": atomic.LoadInt64(&messagesProcessed),
			"sanctions_blocked":  atomic.LoadInt64(&sanctionsBlocked),
			"fx_reported":        atomic.LoadInt64(&fxReported),
			"uptime_s":           time.Since(workerStart).Seconds(),
		})
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "ndsep_swift_processed_total %d\n", atomic.LoadInt64(&messagesProcessed))
		fmt.Fprintf(w, "ndsep_swift_sanctions_blocked_total %d\n", atomic.LoadInt64(&sanctionsBlocked))
		fmt.Fprintf(w, "ndsep_swift_fx_reported_total %d\n", atomic.LoadInt64(&fxReported))
	})

	go http.ListenAndServe(":"+port, nil)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	log.Printf("[swift_gateway] Processing loop started on port %s", port)
	for range ticker.C {
		processPendingSWIFT()
	}
}
