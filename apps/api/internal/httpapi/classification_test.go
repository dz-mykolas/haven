package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestClassificationWorkflow(t *testing.T) {
	database := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("requires disposable PostgreSQL")
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
	if _, err = s.Pool.Exec(ctx, `TRUNCATE transaction_payment_links,recurring_payment_links,task_followup_events,task_followups,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts,money_tags`); err != nil {
		t.Fatal(err)
	}
	id := func(n int) string { return fmt.Sprintf("88000000-0000-4000-8000-%012d", n) }
	if _, err = s.Pool.Exec(ctx, `DELETE FROM money_categories WHERE id=$1 OR id=$2`, id(1), id(2)); err != nil {
		t.Fatal(err)
	}
	handler := New(s, []string{"http://localhost:4321"})
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "http://localhost:4321/api"+path, bytes.NewReader(raw))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: got %d %s want %d", method, path, w.Code, w.Body, want)
		}
		return w.Body.Bytes()
	}
	var initial domain.Snapshot
	json.Unmarshal(call("GET", "/state", nil, 200), &initial)
	if len(initial.Categories) < 3 {
		t.Fatal("missing default categories")
	}
	category := domain.Category{ID: id(1), Name: "Pet care"}
	json.Unmarshal(call("PUT", "/categories/"+category.ID, category, 200), &category)
	call("PUT", "/categories/"+id(2), domain.Category{ID: id(2), Name: " pet care "}, 409)
	call("PUT", "/categories/"+id(2), domain.Category{ID: id(2), Name: "Uncategorized"}, 400)
	account := domain.Account{ID: id(3), Name: "Cash", Currency: "EUR"}
	call("PUT", "/accounts/"+account.ID, account, 200)
	entry := domain.Entry{ID: id(4), AccountID: account.ID, Kind: "expense", Amount: 2990, Date: "2026-09-21", Payee: "Vet", CategoryID: category.ID, Tags: []string{"Pets", " pets ", "Shared   costs"}, Notes: "Annual vaccination"}
	var saved domain.Entry
	json.Unmarshal(call("PUT", "/entries/"+entry.ID, entry, 200), &saved)
	if saved.Category != "Pet care" || len(saved.Tags) != 2 || saved.Tags[0] != "Pets" || saved.Tags[1] != "Shared costs" {
		t.Fatalf("normalization: %+v", saved)
	}
	call("PUT", "/entries/"+entry.ID, entry, 200) // Retried create after canonical normalization.
	category.Name = "Pets & care"
	json.Unmarshal(call("PUT", "/categories/"+category.ID, category, 200), &category)
	category.Hidden = true
	json.Unmarshal(call("PUT", "/categories/"+category.ID, category, 200), &category)
	var state domain.Snapshot
	json.Unmarshal(call("GET", "/state", nil, 200), &state)
	if state.Entries[0].Category != "Pets & care" || state.Entries[0].CategoryID != category.ID || len(state.Tags) != 2 {
		t.Fatal("rename lost assignment or tag catalog")
	}
	saved.Notes = "Keep receipt"
	json.Unmarshal(call("PUT", "/entries/"+saved.ID, saved, 200), &saved) // Retain a hidden assignment.
	stale := saved
	stale.Version--
	call("PUT", "/entries/"+saved.ID, stale, 409)
	other := entry
	other.ID = id(5)
	call("PUT", "/entries/"+other.ID, other, 400) // New assignments cannot use hidden categories.
	other.CategoryID = ""
	other.Tags = []string{"PETS"}
	json.Unmarshal(call("PUT", "/entries/"+other.ID, other, 200), &other)
	if other.Tags[0] != "Pets" {
		t.Fatal("case variant made a new tag")
	}
	saved.CategoryID = ""
	saved.Tags = []string{}
	saved.Notes = ""
	json.Unmarshal(call("PUT", "/entries/"+saved.ID, saved, 200), &saved)
	if saved.Category != "" || len(saved.Tags) != 0 || saved.Notes != "" {
		t.Fatal("could not clear annotations")
	}
	oversized := saved
	oversized.Tags = []string{strings.Repeat("x", 41)}
	call("PUT", "/entries/"+saved.ID, oversized, 400)
	var backup store.Backup
	json.Unmarshal(call("GET", "/export", nil, 200), &backup)
	if len(backup.Categories) < 4 || len(backup.Tags) != 2 {
		t.Fatal("catalogs missing from export")
	}
}
