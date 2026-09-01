package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
	tb "github.com/tigerbeetle/tigerbeetle-go"
)

type fakeTigerBeetleClient struct {
	accountResults  []tb.CreateAccountResult
	transferResults []tb.CreateTransferResult
	createdAccounts []tb.Account
	createdTransfer []tb.Transfer
	lookupAccounts  []tb.Account
}

func (f *fakeTigerBeetleClient) CreateAccounts(accounts []tb.Account) ([]tb.CreateAccountResult, error) {
	f.createdAccounts = append(f.createdAccounts, accounts...)
	return f.accountResults, nil
}

func (f *fakeTigerBeetleClient) CreateTransfers(transfers []tb.Transfer) ([]tb.CreateTransferResult, error) {
	f.createdTransfer = append(f.createdTransfer, transfers...)
	return f.transferResults, nil
}

func (f *fakeTigerBeetleClient) LookupAccounts([]tb.Uint128) ([]tb.Account, error) {
	return f.lookupAccounts, nil
}

func (f *fakeTigerBeetleClient) LookupTransfers([]tb.Uint128) ([]tb.Transfer, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) GetAccountTransfers(tb.AccountFilter) ([]tb.Transfer, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) GetAccountBalances(tb.AccountFilter) ([]tb.AccountBalance, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) QueryAccounts(tb.QueryFilter) ([]tb.Account, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) QueryTransfers(tb.QueryFilter) ([]tb.Transfer, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) GetChangeEvents(tb.ChangeEventsFilter) ([]tb.ChangeEvent, error) {
	return nil, nil
}

func (f *fakeTigerBeetleClient) Nop() error { return nil }
func (f *fakeTigerBeetleClient) Close()     {}

func decodeResponse(t *testing.T, recorder *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var response map[string]interface{}
	if err := json.NewDecoder(recorder.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v; body=%q", err, recorder.Body.String())
	}
	return response
}

func TestAmountInMinorUnitsUsesExactDecimals(t *testing.T) {
	amount, minor, err := amountInMinorUnits(json.Number("100.25"))
	if err != nil {
		t.Fatalf("expected valid amount: %v", err)
	}
	if minor != "10025" || amount.BigInt().String() != "10025" {
		t.Fatalf("expected 10025 minor units, got minor=%s amount=%s", minor, amount.BigInt())
	}

	for _, value := range []json.Number{"0", "1.234", "1e2", "-1", "abc"} {
		if _, _, err := amountInMinorUnits(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestValidateCreateResultsAcceptsOnlyExactIdempotentStatus(t *testing.T) {
	if err := validateCreateResults(
		[]tb.CreateAccountResult{{Status: tb.AccountExists}},
		func(result tb.CreateAccountResult) string {
			if result.Status == tb.AccountExists {
				return ""
			}
			return result.Status.String()
		},
	); err != nil {
		t.Fatalf("expected AccountExists to be an idempotent success: %v", err)
	}

	if err := validateCreateResults(
		[]tb.CreateTransferResult{{Status: tb.TransferExistsWithDifferentAmount}},
		func(result tb.CreateTransferResult) string { return result.Status.String() },
	); err == nil || !strings.Contains(err.Error(), "TransferExistsWithDifferentAmount") {
		t.Fatalf("expected conflicting duplicate rejection, got %v", err)
	}
}

func TestTransactionPostsExactNGNTransferAndAcknowledgesIdempotency(t *testing.T) {
	client := &fakeTigerBeetleClient{
		accountResults:  []tb.CreateAccountResult{{Status: tb.AccountExists}},
		transferResults: []tb.CreateTransferResult{{Status: tb.TransferExists}},
	}
	app := &application{client: client}

	request := httptest.NewRequest(http.MethodPost, "/transaction", bytes.NewBufferString(`{
		"org_id":"bank-000001",
		"penalty_id":"nip-ref-001",
		"amount":100.25,
		"currency":"NGN",
		"type":"transfer",
		"debit_account_id":"bank-000001",
		"credit_account_id":"bank-000002"
	}`))
	request.Header.Set("Idempotency-Key", strings.Repeat("a", 64))
	recorder := httptest.NewRecorder()
	app.transaction(recorder, request)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", recorder.Code, recorder.Body.String())
	}
	if len(client.createdTransfer) != 1 {
		t.Fatalf("expected one TigerBeetle transfer, got %d", len(client.createdTransfer))
	}
	transfer := client.createdTransfer[0]
	if transfer.Ledger != ngnLedgerCode || transfer.Amount.BigInt().String() != "10025" {
		t.Fatalf("expected exact NGN ledger transfer, got ledger=%d amount=%s", transfer.Ledger, transfer.Amount.BigInt())
	}
	response := decodeResponse(t, recorder)
	if response["idempotent"] != true || response["currency"] != "NGN" || response["amount_minor"] != "10025" {
		t.Fatalf("expected durable idempotent response, got %#v", response)
	}
}

func TestTransactionRejectsFractionalOverflowAndUnknownFields(t *testing.T) {
	app := &application{client: &fakeTigerBeetleClient{}}
	for _, body := range []string{
		`{"org_id":"org-1","penalty_id":"p-1","amount":1.234,"currency":"NGN","type":"fine"}`,
		`{"org_id":"org-1","penalty_id":"p-1","amount":1,"currency":"NGN","type":"fine","unexpected":true}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/transaction", bytes.NewBufferString(body))
		recorder := httptest.NewRecorder()
		app.transaction(recorder, request)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %s, got %d: %s", body, recorder.Code, recorder.Body.String())
		}
	}
}

func TestBalanceReportsSignedExactNetPosition(t *testing.T) {
	client := &fakeTigerBeetleClient{lookupAccounts: []tb.Account{{
		DebitsPosted:  tb.ToUint128(10025),
		CreditsPosted: tb.ToUint128(5000),
	}}}
	app := &application{client: client}
	request := httptest.NewRequest(http.MethodGet, "/balance/org-1?currency=NGN", nil)
	request = mux.SetURLVars(request, map[string]string{"org_id": "org-1"})
	recorder := httptest.NewRecorder()
	app.balance(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	response := decodeResponse(t, recorder)
	if response["debits_posted"] != "100.25" || response["credits_posted"] != "50.00" || response["net_position"] != "-50.25" {
		t.Fatalf("expected exact signed balance, got %#v", response)
	}
}
