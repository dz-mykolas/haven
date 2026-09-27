package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
)

func TestPersistentWorkflows(t *testing.T) {
	url := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set HAVEN_TEST_DATABASE_URL for real PostgreSQL integration tests")
	}
	cfg, err := pgx.ParseConfig(url)
	if err != nil || !strings.HasSuffix(cfg.Database, "_test") {
		t.Fatal("integration database name must end in _test")
	}
	ctx := context.Background()
	s, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Pool.Close()
	if _, err = s.Pool.Exec(ctx, `TRUNCATE transaction_payment_links,recurring_payment_links,task_followup_events,task_followups,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts`); err != nil {
		t.Fatal(err)
	}
	handler := New(s, []string{"http://localhost:4321"})
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		var encoded []byte
		if body != nil {
			encoded, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(encoded))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s: got %d %s, want %d", method, path, res.Code, res.Body, want)
		}
		return res.Body.Bytes()
	}
	id := func(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }
	account := domain.Account{ID: id(1), Name: "SEB", Currency: "EUR", Opening: 10000}
	call("PUT", "/api/accounts/"+id(1), account, 200)
	call("PUT", "/api/accounts/"+id(1), account, 200)
	account.Name = "Different create"
	call("PUT", "/api/accounts/"+id(1), account, 409)
	call("PUT", "/api/accounts/"+id(2), domain.Account{ID: id(2), Name: "Revolut", Currency: "EUR"}, 200)
	entry := domain.Entry{ID: id(3), AccountID: id(1), Kind: "expense", Amount: 1234, Date: "2026-09-21", Payee: "Lunch"}
	call("PUT", "/api/entries/"+id(3), entry, 200)
	call("PUT", "/api/entries/"+id(3), entry, 200)
	entry.Version = 1
	entry.Amount = 2000
	call("PUT", "/api/entries/"+id(3), entry, 200)
	call("PUT", "/api/entries/"+id(3), entry, 409)
	call("PUT", "/api/entries/"+id(4), domain.Entry{ID: id(4), AccountID: id(1), DestinationID: id(2), Kind: "transfer", Amount: 1000, Date: "2026-09-21"}, 200)
	var state domain.Snapshot
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, 200), &state)
	if state.Total != "8000" || state.Spending != "2000" || state.Income != "0" || state.Balances[id(1)] != "7000" || state.Balances[id(2)] != "1000" {
		t.Fatalf("bad totals %+v", state)
	}
	entry.Version = 2
	entry.Deleted = true
	call("PUT", "/api/entries/"+id(3), entry, 200)
	entry.Version = 3
	entry.Deleted = false
	call("PUT", "/api/entries/"+id(3), entry, 200)
	task := domain.Task{ID: id(5), Title: "Rent", Date: "2026-01-31", Time: "09:00", Timezone: "Europe/Vilnius", Repeat: "monthly", Kind: "payment", Amount: 50000}
	call("PUT", "/api/tasks/"+id(5), task, 200)
	call("PUT", "/api/tasks/"+id(5), task, 200)
	var next domain.Task
	json.Unmarshal(call("POST", "/api/tasks/"+id(5)+"/complete", CompleteRequest{ID: id(6), Version: 1}, 200), &next)
	if next.Date != "2026-02-28" || next.AnchorDay != 31 {
		t.Fatalf("bad recurrence: %+v", next)
	}
	call("POST", "/api/tasks/"+id(5)+"/complete", CompleteRequest{ID: id(6), Version: 1}, 200)
	call("POST", "/api/tasks/"+id(5)+"/complete", CompleteRequest{ID: id(7), Version: 1}, 409)
	json.Unmarshal(call("POST", "/api/tasks/"+id(5)+"/complete", CompleteRequest{ID: id(7), Version: 2}, 200), &next)
	if next.Date != "2026-03-31" {
		t.Fatalf("anchor lost: %+v", next)
	}
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, 200), &state)
	if len(state.Entries) != 2 || state.Total != "8000" {
		t.Fatal("payment reminder changed money")
	}
	var backup store.Backup
	json.Unmarshal(call("GET", "/api/export", nil, 200), &backup)
	if len(backup.Completions) != 2 || len(backup.Tasks) != 1 {
		t.Fatalf("backup incomplete: %+v", backup)
	}
	// A fresh connection and handler must read the same persisted state.
	reopened, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	handler = New(reopened, []string{"http://localhost:4321"})
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, 200), &state)
	if state.Total != "8000" || state.Tasks[0].Date != "2026-03-31" {
		t.Fatal("records did not persist")
	}
	call("GET", "/api/state?month=nope", nil, 400)
	badEntry := entry
	badEntry.ID = id(8)
	badEntry.Version = 0
	badEntry.AccountID = id(99)
	call("PUT", "/api/entries/"+id(8), badEntry, 400)
	// Simultaneous edits against one version must produce exactly one winner.
	results := make(chan error, 2)
	for _, amount := range []int64{2200, 2300} {
		candidate := entry
		candidate.Version = 4
		candidate.Amount = amount
		go func() { _, err := s.SaveEntry(ctx, candidate); results <- err }()
	}
	wins, conflicts := 0, 0
	for range 2 {
		err := <-results
		var problem *store.Error
		if err == nil {
			wins++
		} else if errors.As(err, &problem) && problem.Status == 409 {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("concurrent update: %d wins, %d conflicts", wins, conflicts)
	}
	for _, host := range []string{"evil.example", "localhost"} {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/api/export", nil)
		req.Header.Set("Origin", "https://evil.example")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != 403 {
			t.Fatal("untrusted browser request accepted")
		}
	}
	// Removing an account preserves the surviving side of a transfer.
	call("DELETE", "/api/accounts/"+id(1), map[string]int{"version": 99}, 409)
	call("DELETE", "/api/accounts/"+id(1), map[string]int{"version": 1}, 200)
	call("DELETE", "/api/accounts/"+id(1), map[string]int{"version": 1}, 200)
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, 200), &state)
	if len(state.Accounts) != 1 || state.Accounts[0].ID != id(2) || state.Total != "1000" || state.Income != "0" || state.Spending != "0" || len(state.Entries) != 1 || state.Entries[0].Kind != "transfer" {
		t.Fatalf("removal damaged remaining account: %+v", state)
	}
	json.Unmarshal(call("GET", "/api/export", nil, 200), &backup)
	if len(backup.Accounts) != 1 || len(backup.Entries) != 1 {
		t.Fatal("removed account leaked into export")
	}
	account.Version = 1
	call("PUT", "/api/accounts/"+id(1), account, 410)
	badEntry.AccountID = id(1)
	call("PUT", "/api/entries/"+id(8), badEntry, 400)
	call("DELETE", "/api/accounts/not-an-id", map[string]int{"version": 1}, 400)
	call("DELETE", "/api/accounts/"+id(99), map[string]int{"version": 1}, 404)
	call("DELETE", "/api/accounts/"+id(2), map[string]int{"version": 1}, 200)
	json.Unmarshal(call("GET", "/api/state?month=2026-09", nil, 200), &state)
	if len(state.Accounts) != 0 || len(state.Entries) != 0 || state.Total != "0" {
		t.Fatal("removal left orphan activity")
	}

	// Calendar projections are read-only and include persisted completion history.
	beforeCalendar := string(call("GET", "/api/state?month=2026-09", nil, 200))
	var calendar domain.TaskCalendar
	json.Unmarshal(call("GET", "/api/tasks/calendar?month=2026-02", nil, 200), &calendar)
	if len(calendar.Items) != 2 || calendar.Items[0].Date != "2026-01-31" || !calendar.Items[0].Completed || calendar.Items[1].Date != "2026-02-28" || !calendar.Items[1].Completed {
		t.Fatalf("calendar lost recurring completion: %+v", calendar)
	}
	json.Unmarshal(call("GET", "/api/tasks/calendar?month=2026-04", nil, 200), &calendar)
	if len(calendar.Items) != 2 || calendar.Items[0].Date != "2026-03-31" || calendar.Items[0].Projected || calendar.Items[1].Date != "2026-04-30" || !calendar.Items[1].Projected {
		t.Fatalf("calendar recurrence wrong: %+v", calendar)
	}
	if string(call("GET", "/api/state?month=2026-09", nil, 200)) != beforeCalendar {
		t.Fatal("viewing calendar changed tasks or Money")
	}
	call("GET", "/api/tasks/calendar?month=bad", nil, 400)
	call("GET", "/api/tasks/calendar", nil, 400)

}
