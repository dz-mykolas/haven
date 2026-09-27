package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
	"math/big"
)

type bankTransport func(*http.Request) (*http.Response, error)

func (f bankTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestBankConnectionWorkflow(t *testing.T) {
	database := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("set HAVEN_TEST_DATABASE_URL for PostgreSQL bank workflow tests")
	}
	cfg, err := pgx.ParseConfig(database)
	if err != nil || !strings.HasSuffix(cfg.Database, "_test") {
		t.Fatal("test database must end in _test")
	}
	ctx := context.Background()
	s, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Pool.Close()
	if _, err := s.Pool.Exec(ctx, `TRUNCATE bank_authorizations,bank_connections,bank_ledger_transactions,bank_ledger_accounts`); err != nil {
		t.Fatal(err)
	}
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	keyPath := filepath.Join(t.TempDir(), "test.pem")
	os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), 0600)
	callback := "http://localhost:4321/api/banking/callback"
	var fixture struct {
		Accounts []struct {
			Info         banking.Account       `json:"info"`
			Balances     []banking.Balance     `json:"balances"`
			Transactions []banking.Transaction `json:"transactions"`
		} `json:"accounts"`
	}
	contents, err := os.ReadFile("../../../../tests/fixtures/enable-banking/smoke.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(contents, &fixture); err != nil {
		t.Fatal(err)
	}
	for i := range fixture.Accounts {
		fixture.Accounts[i].Info.UID = fmt.Sprintf("provider-account-secret-%d", i)
		fixture.Accounts[i].Info.IdentificationHash = fmt.Sprintf("stable-hash-%d", i)
	}
	state := ""
	failPage := false
	removedFirst := false
	authorizedAccounts := []banking.Account{fixture.Accounts[0].Info, fixture.Accounts[1].Info}
	deleted := 0
	exchanges := 0
	client, err := banking.New(banking.Config{AppID: "test-app", KeyPath: keyPath, RedirectURL: callback}, bankTransport(func(r *http.Request) (*http.Response, error) {
		if removedFirst && strings.Contains(r.URL.Path, "/provider-account-secret-0/") {
			t.Fatal("removed account was fetched from provider")
		}
		status := 200
		var value any
		switch r.URL.Path {
		case "/application":
			value = map[string]any{"environment": "SANDBOX", "active": true, "redirect_urls": []string{callback}}
		case "/aspsps":
			value = map[string]any{"aspsps": []banking.Bank{{Name: "Mock ASPSP", Country: "LT", MaxConsent: 86400, PSUTypes: []string{"personal"}}}}
		case "/auth":
			var input map[string]any
			json.NewDecoder(r.Body).Decode(&input)
			state = input["state"].(string)
			value = map[string]string{"url": "https://auth.enablebanking.com/ais/start?sessionid=authorization-secret"}
		case "/sessions":
			exchanges++
			value = map[string]any{"session_id": "session-secret", "aspsp": map[string]string{"name": "Mock ASPSP", "country": "LT"}, "access": map[string]any{"valid_until": time.Now().Add(time.Hour)}, "accounts": authorizedAccounts}
		case "/accounts/provider-account-secret-0/balances", "/accounts/provider-account-secret-1/balances":
			index := 0
			if strings.Contains(r.URL.Path, "secret-1/") {
				index = 1
			}
			value = map[string]any{"balances": fixture.Accounts[index].Balances}
		case "/accounts/provider-account-secret-0/transactions", "/accounts/provider-account-secret-1/transactions":
			if failPage && r.URL.Query().Get("continuation_key") != "" {
				status = 500
				value = map[string]string{"error": "private error details"}
				break
			}
			index := 0
			if strings.Contains(r.URL.Path, "secret-1/") {
				index = 1
			}
			entries := fixture.Accounts[index].Transactions
			next := ""
			if len(entries) > 10 {
				if r.URL.Query().Get("continuation_key") == "" {
					entries = entries[:10]
					next = "page-2"
				} else {
					entries = entries[10:]
				}
			}
			value = map[string]any{"transactions": entries, "continuation_key": next}
		case "/sessions/session-secret":
			if r.Method != "DELETE" {
				t.Fatal("expected remote revocation")
			}
			deleted++
			value = map[string]string{"message": "OK"}
		default:
			t.Fatalf("unexpected provider path %s", r.URL.Path)
		}
		encoded, _ := json.Marshal(value)
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(encoded))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	handler := New(s, []string{"http://localhost:4321"}, client)
	call := func(method, path string, body any, cookie *http.Cookie, crossSite bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		data, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "http://localhost:4321"+path, bytes.NewReader(data))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		if crossSite {
			req.Header.Set("Sec-Fetch-Site", "cross-site")
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s %s got %d %s want %d", method, path, rec.Code, rec.Body, want)
		}
		return rec
	}
	before := call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String()
	call("POST", "/api/banking/authorize", map[string]string{"name": "Imaginary bank", "country": "LT"}, nil, false, 400)
	call("POST", "/api/banking/authorize", map[string]string{}, nil, true, 403)
	start := func() *http.Cookie {
		rec := call("POST", "/api/banking/authorize", map[string]string{"name": "Mock ASPSP", "country": "LT"}, nil, false, 200)
		cookie := rec.Result().Cookies()[0]
		if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != banking.CallbackPath {
			t.Fatal("cookie policy")
		}
		return cookie
	}
	cookie := start()
	callbackPath := banking.CallbackPath + "?code=code-secret&state=" + url.QueryEscape(state)
	call("GET", callbackPath, nil, nil, true, 400)
	call("GET", banking.CallbackPath+"?code=code-secret&state="+banking.RandomToken(), nil, cookie, true, 400)
	wrongCookie := *cookie
	wrongCookie.Value = banking.RandomToken()
	call("GET", callbackPath, nil, &wrongCookie, true, 400)
	response := call("GET", callbackPath, nil, cookie, true, 303)
	location, _ := url.Parse(response.Header().Get("Location"))
	id := location.Query().Get("connection")
	if id == "" || location.Query().Get("banking") != "connected" {
		t.Fatalf("bad redirect %s", location)
	}
	call("GET", callbackPath, nil, cookie, true, 400)
	if exchanges != 1 {
		t.Fatal("replayed callback exchanged twice")
	}
	if strings.Contains(response.Header().Get("Location"), "secret") {
		t.Fatal("secret exposed in redirect")
	}
	updatePath := "/api/banking/connections/" + id
	for i := 0; i < 2; i++ {
		call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 200)
	}
	response = call("GET", "/api/banking", nil, nil, false, 200)
	var data struct {
		Connections []store.BankConnection `json:"connections"`
	}
	json.Unmarshal(response.Body.Bytes(), &data)
	if len(data.Connections) != 1 || len(data.Connections[0].Accounts[0].Transactions) != 13 {
		t.Fatalf("bad snapshot %s", response.Body)
	}
	if strings.Contains(response.Body.String(), "secret") {
		t.Fatal("session or account UID leaked")
	}
	syncedAt := *data.Connections[0].SyncedAt
	failPage = true
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 502)
	response = call("GET", "/api/banking", nil, nil, false, 200)
	json.Unmarshal(response.Body.Bytes(), &data)
	if !data.Connections[0].SyncedAt.Equal(syncedAt) || len(data.Connections[0].Accounts[0].Transactions) != 13 {
		t.Fatal("failed refresh replaced snapshot")
	}
	failPage = false
	// Both the raw snapshot and imported ledger survive reopening.
	reopened, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := reopened.BankConnections(ctx)
	reopened.Pool.Close()
	if err != nil || len(persisted) != 1 || len(persisted[0].Accounts[0].Transactions) != 13 {
		t.Fatal("snapshot not persistent")
	}
	after := call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String()
	var initial, imported domain.Snapshot
	json.Unmarshal([]byte(before), &initial)
	json.Unmarshal([]byte(after), &imported)
	delta := func(a, b string) string {
		x, _ := new(big.Int).SetString(a, 10)
		y, _ := new(big.Int).SetString(b, 10)
		return x.Sub(x, y).String()
	}
	if len(imported.Accounts)-len(initial.Accounts) != 2 || len(imported.Entries)-len(initial.Entries) != 13 || delta(imported.Total, initial.Total) != "372724" || delta(imported.Income, initial.Income) != "240000" || delta(imported.Spending, initial.Spending) != "17276" {
		t.Fatalf("incorrect imported totals: %+v", imported)
	}
	transfers := 0
	ids := map[string]bool{}
	for _, e := range imported.Entries {
		if e.Source == "" {
			continue
		}
		ids[e.ID] = true
		if e.Kind == "transfer" {
			transfers++
			if e.Amount != 20000 {
				t.Fatal("wrong transfer amount")
			}
		}
		// Bank records cannot be edited, deleted, or spoofed as manual records.
		call("PUT", "/api/entries/"+e.ID, e, nil, false, 400)
		e.Source = ""
		e.Version = 0
		call("PUT", "/api/entries/"+e.ID, e, nil, false, 400)
	}
	if transfers != 1 {
		t.Fatal("transfer pair not collapsed")
	}
	for _, a := range imported.Accounts {
		if a.Source != "" {
			a.Source = ""
			a.BankBalance = nil
			a.Version = 0
			call("PUT", "/api/accounts/"+a.ID, a, nil, false, 400)
		}
	}
	// A new consent/session must reuse account IDs and entry references.
	cookie = start()
	call("GET", banking.CallbackPath+"?code=reconnect&state="+url.QueryEscape(state), nil, cookie, true, 303)
	response = call("GET", "/api/banking", nil, nil, false, 200)
	json.Unmarshal(response.Body.Bytes(), &data)
	reconnectedID := data.Connections[0].ID
	call("POST", "/api/banking/connections/"+reconnectedID+"/refresh", map[string]any{}, nil, false, 200)
	reconnected := call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String()
	if reconnected != after {
		t.Fatal("reconnection duplicated or changed the ledger")
	}
	// Concurrent refreshes from two consent sessions reuse the same ledger rows.
	failures := make(chan error, 2)
	for _, connectionID := range []string{id, reconnectedID} {
		go func(connectionID string) {
			failures <- s.UpdateBankConnection(ctx, connectionID, "test-app", false, client)
		}(connectionID)
	}
	for i := 0; i < 2; i++ {
		if err := <-failures; err != nil {
			t.Fatal(err)
		}
	}
	if got := call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String(); got != after {
		t.Fatal("concurrent refresh changed ledger")
	}
	// Personal annotations use a separate endpoint and survive source refreshes.
	var annotated domain.Entry
	for _, e := range imported.Entries {
		if e.Source != "" && e.Kind == "expense" {
			annotated = e
			break
		}
	}
	var categoryID string
	for _, c := range imported.Categories {
		if c.Name == "Everyday" {
			categoryID = c.ID
		}
	}
	if categoryID == "" {
		t.Fatal("default category missing")
	}
	metadata := store.BankAnnotations{CategoryID: categoryID, Tags: []string{"Work", " work ", "Reimbursable"}, Notes: "Keep this receipt", Version: annotated.Version}
	call("PUT", "/api/banking/transactions/"+annotated.ID+"/annotations", metadata, nil, false, 200)
	call("PUT", "/api/banking/transactions/"+annotated.ID+"/annotations", metadata, nil, false, 409)
	call("PUT", "/api/banking/transactions/"+annotated.ID+"/annotations", map[string]any{"amount_minor": "1", "version": 2}, nil, false, 400)
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 200)
	call("POST", "/api/banking/connections/"+reconnectedID+"/refresh", map[string]any{}, nil, false, 200)
	after = call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String()
	var labeled domain.Snapshot
	json.Unmarshal([]byte(after), &labeled)
	for _, e := range labeled.Entries {
		if e.ID == annotated.ID {
			if e.Notes != "Keep this receipt" || e.CategoryID != categoryID || len(e.Tags) != 2 || e.Version != 2 || e.BankDescription != annotated.BankDescription {
				t.Fatalf("sync lost user annotations: %+v", e)
			}
		}
	}
	// Invalid booked data must roll back every imported row and balance.
	fixture.Accounts[0].Balances[0].Amount.Amount = "9999.99"
	fixture.Accounts[1].Transactions[1].Reference = ""
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 400)
	if got := call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.String(); got != after {
		t.Fatal("failed import partially changed ledger")
	}
	fixture.Accounts[1].Transactions[1].Reference = "haven-pocket-expense"
	fixture.Accounts[0].Balances[0].Amount.Amount = "3049.23"
	// Provider corrections update the same record, and absent older history is kept.
	fixture.Accounts[1].Transactions[1].Amount.Amount = "22.99"
	fixture.Accounts[0].Transactions = fixture.Accounts[0].Transactions[:1]
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 200)
	var updated domain.Snapshot
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.Bytes(), &updated)
	if len(updated.Entries) != len(imported.Entries) || delta(updated.Spending, imported.Spending) != "100" || updated.Total != imported.Total {
		t.Fatal("correction/history/balance reconciliation failed")
	}
	for _, e := range updated.Entries {
		if e.Source != "" && !ids[e.ID] {
			t.Fatal("correction changed stable ID")
		}
	}
	var backup store.Backup
	json.Unmarshal(call("GET", "/api/export", nil, nil, false, 200).Body.Bytes(), &backup)
	if len(backup.Accounts) != len(updated.Accounts) {
		t.Fatal("bank accounts missing from export")
	}
	cookie = start()
	call("GET", banking.CallbackPath+"?error=access_denied&state="+state, nil, cookie, true, 303)
	if exchanges != 2 {
		t.Fatal("cancelled auth exchanged code")
	}
	cookie = start()
	s.Pool.Exec(ctx, `UPDATE bank_authorizations SET expires_at=now()-interval '1 minute'`)
	call("GET", banking.CallbackPath+"?code=x&state="+state, nil, cookie, true, 400)
	s.Pool.Exec(ctx, `UPDATE bank_connections SET valid_until=now()-interval '1 minute' WHERE id=$1`, id)
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 409)
	call("POST", updatePath+"/disconnect", map[string]any{}, nil, false, 200)
	call("POST", updatePath+"/disconnect", map[string]any{}, nil, false, 200)
	if deleted != 1 {
		t.Fatal("disconnect retry was not idempotent")
	}
	call("POST", updatePath+"/refresh", map[string]any{}, nil, false, 409)
	var remaining []byte
	s.Pool.QueryRow(ctx, `SELECT session_data FROM bank_connections WHERE id=$1`, id).Scan(&remaining)
	if string(remaining) != "{}" {
		t.Fatal("revoked session secret retained")
	}
	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	if len(data.Connections) != 1 || data.Connections[0].ID != reconnectedID {
		t.Fatal("disconnected connection card remained")
	}
	// Refresh must not restore a removed account; new consent restores only selected accounts.
	var removedAccount, keptAccount domain.Account
	for _, a := range updated.Accounts {
		if a.Source == "" {
			continue
		}
		if a.Name == fixture.Accounts[0].Info.Details {
			removedAccount = a
		} else {
			keptAccount = a
		}
	}
	if removedAccount.ID == "" || keptAccount.ID == "" {
		t.Fatal("fixture account lookup failed")
	}
	call("DELETE", "/api/accounts/"+removedAccount.ID, map[string]int{"version": 2}, nil, false, 409)
	call("DELETE", "/api/accounts/"+removedAccount.ID, map[string]int{"version": 1}, nil, false, 200)
	removedFirst = true
	call("POST", "/api/banking/connections/"+reconnectedID+"/refresh", map[string]any{}, nil, false, 200)
	authorizedAccounts = []banking.Account{fixture.Accounts[1].Info}
	cookie = start()
	call("GET", banking.CallbackPath+"?code=after-removal&state="+url.QueryEscape(state), nil, cookie, true, 303)
	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	call("POST", "/api/banking/connections/"+data.Connections[0].ID+"/refresh", map[string]any{}, nil, false, 200)
	if len(data.Connections) != 2 || data.Connections[0].SyncedAt != nil {
		t.Fatal("fresh connection with a remaining account must stay visible before sync")
	}
	var afterRemoval domain.Snapshot
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.Bytes(), &afterRemoval)
	if len(afterRemoval.Accounts) != len(updated.Accounts)-1 || delta(updated.Total, afterRemoval.Total) != "304923" || delta(afterRemoval.Income, initial.Income) != "0" || delta(afterRemoval.Spending, initial.Spending) != "2299" {
		t.Fatalf("bank removal totals wrong: %+v", afterRemoval)
	}
	for _, e := range afterRemoval.Entries {
		if e.AccountID == removedAccount.ID && (e.Kind != "transfer" || e.DestinationID != keptAccount.ID) {
			t.Fatal("removed account activity visible")
		}
	}
	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	for _, conn := range data.Connections {
		for _, item := range conn.Accounts {
			if item.Account.IdentificationHash == fixture.Accounts[0].Info.IdentificationHash {
				t.Fatal("removed account in connection details")
			}
		}
	}
	json.Unmarshal(call("GET", "/api/export", nil, nil, false, 200).Body.Bytes(), &backup)
	if len(backup.Accounts) != len(afterRemoval.Accounts) {
		t.Fatal("removed bank account exported")
	}
	call("DELETE", "/api/accounts/"+keptAccount.ID, map[string]int{"version": 1}, nil, false, 200)
	call("POST", "/api/banking/connections/"+reconnectedID+"/refresh", map[string]any{}, nil, false, 409)
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.Bytes(), &afterRemoval)
	if len(afterRemoval.Accounts) != len(initial.Accounts) || afterRemoval.Total != initial.Total || len(afterRemoval.Entries) != len(initial.Entries) {
		t.Fatal("bank removal changed unrelated manual data")
	}

	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	if len(data.Connections) != 0 {
		t.Fatal("empty old connection cards remained")
	}
	// Explicitly selecting both accounts again restores the same ledger IDs.
	removedFirst = false
	authorizedAccounts = []banking.Account{fixture.Accounts[0].Info, fixture.Accounts[1].Info}
	cookie = start()
	call("GET", banking.CallbackPath+"?code=restore-removed&state="+url.QueryEscape(state), nil, cookie, true, 303)
	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	if len(data.Connections) != 1 || data.Connections[0].SyncedAt != nil {
		t.Fatal("new consent did not replace empty connection cards")
	}
	restoredID := data.Connections[0].ID
	call("POST", "/api/banking/connections/"+restoredID+"/refresh", map[string]any{}, nil, false, 200)
	call("POST", "/api/banking/connections/"+restoredID+"/refresh", map[string]any{}, nil, false, 200)
	var restored domain.Snapshot
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, nil, false, 200).Body.Bytes(), &restored)
	if len(restored.Accounts) != len(updated.Accounts) || len(restored.Entries) != len(updated.Entries) || restored.Total != updated.Total || restored.Income != updated.Income || restored.Spending != updated.Spending {
		t.Fatal("reconnecting removed accounts duplicated or lost data")
	}
	for _, a := range restored.Accounts {
		if a.Source != "" && a.ID != removedAccount.ID && a.ID != keptAccount.ID {
			t.Fatal("restored account ID changed")
		}
	}
	for _, e := range restored.Entries {
		if e.ID == annotated.ID && (e.Notes != "Keep this receipt" || e.CategoryID != categoryID || len(e.Tags) != 2) {
			t.Fatal("reconnect lost personal annotations")
		}
	}
	// Old sessions stay empty even after a fresh consent restores the accounts.
	call("POST", "/api/banking/connections/"+reconnectedID+"/refresh", map[string]any{}, nil, false, 409)
	call("DELETE", "/api/accounts/"+removedAccount.ID, map[string]int{"version": 1}, nil, false, 200)
	removedFirst = true
	call("POST", "/api/banking/connections/"+restoredID+"/refresh", map[string]any{}, nil, false, 200)
	call("DELETE", "/api/accounts/"+keptAccount.ID, map[string]int{"version": 1}, nil, false, 200)
	// A genuinely new account must not disappear merely because no snapshot exists.
	fresh := banking.Session{ID: "fresh-session", Accounts: []banking.Account{{UID: "fresh-account", IdentificationHash: "new-identity"}}, Access: banking.Access{ValidUntil: time.Now().Add(time.Hour)}}
	fresh.ASPSP.Name = "Mock ASPSP"
	fresh.ASPSP.Country = "LT"
	freshID, err := s.SaveBankSession(ctx, "test-app", fresh)
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(call("GET", "/api/banking", nil, nil, false, 200).Body.Bytes(), &data)
	if len(data.Connections) != 1 || data.Connections[0].ID != freshID || data.Connections[0].SyncedAt != nil {
		t.Fatal("new unsynced account connection was hidden")
	}

}
