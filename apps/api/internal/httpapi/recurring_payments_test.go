package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestRecurringPaymentSavePaths(t *testing.T) {
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
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := s.Pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`TRUNCATE transaction_payment_links,recurring_payment_links,assistant_reviews,task_followup_events,task_followups,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts`)
	id := func(n int) string { return fmt.Sprintf("90000000-0000-4000-8000-%012d", n) }
	a, err := s.SaveAccount(ctx, domain.Account{ID: id(1), Name: "Wallet", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	var recurring string
	if err = s.Pool.QueryRow(ctx, `SELECT id::text FROM money_categories WHERE name='Recurring'`).Scan(&recurring); err != nil {
		t.Fatal(err)
	}
	plan := func(n int, name string) *domain.Task {
		return &domain.Task{ID: id(n), Title: name, Date: "2026-10-05", Timezone: "Europe/Vilnius", Repeat: "monthly", Kind: "payment", Amount: 1599}
	}
	entry := domain.Entry{ID: id(2), AccountID: a.ID, Kind: "expense", Amount: 1599, Date: "2026-09-05", Payee: "Netflix", CategoryID: recurring, Payment: plan(3, "Netflix")}
	manual, err := s.SaveEntry(ctx, entry)
	if err != nil || manual.Payment == nil {
		t.Fatalf("manual schedule: %+v, %v", manual, err)
	}
	// A second historical payment proposing a different task reuses the first.
	older := entry
	older.ID, older.Date, older.Payee = id(4), "2026-08-05", " NETFLIX "
	older.Payment = plan(5, "Netflix")
	older.Payment.Date = "2026-09-05"
	duplicate, err := s.SaveEntry(ctx, older)
	if err != nil || duplicate.Payment.ID != manual.Payment.ID || duplicate.Payment.Date != "2026-10-05" {
		t.Fatalf("duplicated or rewound schedule: %+v, %v", duplicate.Payment, err)
	}
	// Standalone task changes use the same version checks as nested edits.
	stale := *manual.Payment
	changed := stale
	changed.Amount = 1699
	if _, err = s.SaveTask(ctx, changed); err != nil {
		t.Fatal(err)
	}
	manual.Notes, manual.Payment = "must roll back", &stale
	if _, err = s.SaveEntry(ctx, manual); err == nil {
		t.Fatal("accepted stale linked task")
	}
	var notes string
	if err = s.Pool.QueryRow(ctx, `SELECT notes FROM entries WHERE id=$1`, manual.ID).Scan(&notes); err != nil || notes != "" {
		t.Fatal("task conflict partially saved annotations")
	}
	invalid := entry
	invalid.ID, invalid.Payment = id(6), plan(7, "Bad schedule")
	invalid.Payment.Date = "not-a-date"
	if _, err = s.SaveEntry(ctx, invalid); err == nil {
		t.Fatal("invalid schedule accepted")
	}
	var count int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM entries WHERE id=$1`, invalid.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid schedule partially saved entry")
	}
	// Bank annotation and inbox approval paths save the identical task shape.
	bankID := id(10)
	exec(`INSERT INTO bank_ledger_accounts(id,app_id,bank_name,country,identity_hash,environment,name,currency,iban,balance_minor) VALUES($1,'test','Test','LT','recurring-test','SANDBOX','Bank','EUR','LT000',10000)`, bankID)
	for i, merchant := range []string{"Telia", "Spotify"} {
		txn := banking.Transaction{Reference: merchant, Status: "BOOK", Direction: "DBIT", BookingDate: "2026-09-05", Amount: banking.Amount{Amount: "15.99", Currency: "EUR"}}
		raw, _ := json.Marshal(txn)
		exec(`INSERT INTO bank_ledger_transactions(id,account_id,reference,payload) VALUES($1,$2,$3,$4)`, id(11+i), bankID, merchant, raw)
	}
	bankPlan := plan(13, "Telia")
	if _, err = s.SaveBankAnnotations(ctx, id(11), store.BankAnnotations{CategoryID: recurring, Payment: bankPlan, Version: 1}); err != nil {
		t.Fatal(err)
	}
	snap, err := s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	var original domain.Entry
	for _, e := range snap.Entries {
		if e.ID == id(12) {
			original = e
		}
	}
	raw, _ := json.Marshal(original)
	exec(`INSERT INTO assistant_reviews(entry_id,original,draft,status) VALUES($1,$2,$2,'review')`, original.ID, raw)
	if err = s.ApplyReview(ctx, original.ID, store.BankAnnotations{CategoryID: recurring, Payment: plan(14, "Spotify"), Version: original.Version}); err != nil {
		t.Fatal(err)
	}
	snap, err = s.Snapshot(ctx, "2026-09")
	if err != nil || len(snap.Tasks) != 3 {
		t.Fatalf("expected three payment tasks: %+v %v", snap.Tasks, err)
	}
	for _, e := range snap.Entries {
		if e.Payment == nil {
			t.Fatalf("schedule missing from transaction %s", e.ID)
		}
		if e.Amount != 1599 {
			t.Fatal("scheduling changed a transaction amount")
		}
	}
	upcoming := domain.Upcoming(snap.Tasks, "2026-10-01")
	if len(upcoming.Items) != 3 || upcoming.Minimum != "4897" {
		t.Fatalf("tasks missing from Upcoming: %+v", upcoming)
	}
	// Reopening retains associations and schedules.
	reopened, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	snap, err = reopened.Snapshot(ctx, "2026-09")
	if err != nil || len(snap.Tasks) != 3 || snap.Entries[0].Payment == nil {
		t.Fatal("schedule did not survive restart")
	}
}
