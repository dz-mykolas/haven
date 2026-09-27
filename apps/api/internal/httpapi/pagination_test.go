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
	"net/http/httptest"
	"net/url"
)

func TestCursorFeeds(t *testing.T) {
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
	exec(`TRUNCATE transaction_payment_links,recurring_payment_links,assistant_reviews,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts`)
	id := func(n int) string { return fmt.Sprintf("92000000-0000-4000-8000-%012d", n) }
	a, err := s.SaveAccount(ctx, domain.Account{ID: id(1), Name: "Wallet", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}

	// Equal dates deliberately stress the stable ID tie breaker.
	for n := 10; n < 140; n++ {
		exec(`INSERT INTO entries(id,account_id,kind,amount_minor,date,payee,category,notes,version) VALUES($1,$2,'expense',100,'2026-09-01',$3,'','',1)`, id(n), a.ID, fmt.Sprintf("Purchase %d", n))
	}
	bankID, otherID := id(200), id(201)
	exec(`INSERT INTO bank_ledger_accounts(id,app_id,bank_name,country,identity_hash,environment,name,currency,iban,balance_minor) VALUES($1,'pages','Test','LT','pages-1','SANDBOX','Bank A','EUR','LT001',10000),($2,'pages','Test','LT','pages-2','SANDBOX','Bank B','EUR','LT002',10000)`, bankID, otherID)
	for i, row := range []struct{ date, direction, account, other string }{{"2026-09-30", "DBIT", bankID, "LT002"}, {"2026-10-02", "CRDT", otherID, "LT001"}} {
		txn := banking.Transaction{Reference: fmt.Sprint(i), Status: "BOOK", Direction: row.direction, BookingDate: row.date, Amount: banking.Amount{Amount: "5.00", Currency: "EUR"}}
		txn.CreditorAccount.IBAN = row.other
		txn.DebtorAccount.IBAN = row.other
		raw, _ := json.Marshal(txn)
		exec(`INSERT INTO bank_ledger_transactions(id,account_id,reference,payload) VALUES($1,$2,$3,$4)`, id(210+i), row.account, txn.Reference, raw)
	}
	snap, err := s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range snap.Entries {
		if e.AccountID == a.ID {
			raw, _ := json.Marshal(e)
			exec(`INSERT INTO assistant_reviews(entry_id,original,draft,status) VALUES($1,$2,$2,'review')`, e.ID, raw)
		}
	}
	handler := New(s, []string{"http://localhost:4321"})
	get := func(path string, want int) []byte {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "http://localhost:4321/api"+path, nil))
		if w.Code != want {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		return w.Body.Bytes()
	}
	var first store.ActivityPage
	json.Unmarshal(get("/entries?month=2026-09", 200), &first)
	if len(first.Items) != 50 || first.Total != 131 || first.NextCursor == "" || first.Items[0].Kind != "transfer" {
		t.Fatalf("first page lost transfer or page size: %+v", first)
	}
	// Deleting an earlier item must not offset later pages. A new first item
	// should be seen on refresh, never injected partway through an older cursor.
	exec(`UPDATE entries SET deleted=true,version=version+1 WHERE id=$1`, first.Items[1].ID)
	exec(`INSERT INTO entries(id,account_id,kind,amount_minor,date,payee,category,notes,version) VALUES($1,$2,'expense',100,'2026-09-29','New purchase','','',1)`, id(300), a.ID)
	seen := map[string]bool{}
	for _, e := range first.Items {
		seen[e.ID] = true
	}
	cursor := first.NextCursor
	for cursor != "" {
		var page store.ActivityPage
		json.Unmarshal(get("/entries?month=2026-09&cursor="+url.QueryEscape(cursor), 200), &page)
		if len(page.Items) > 50 {
			t.Fatal("unbounded page")
		}
		for _, e := range page.Items {
			if seen[e.ID] || e.ID == id(300) {
				t.Fatal("duplicate or unstable cursor")
			}
			seen[e.ID] = true
		}
		cursor = page.NextCursor
	}
	if len(seen) != 131 {
		t.Fatalf("skipped records after deletion: %d", len(seen))
	}
	get("/entries?month=2026-10&cursor="+url.QueryEscape(first.NextCursor), 400)
	get("/entries?cursor=garbage", 400)
	get("/entries?month=invalid", 400)
	var filtered store.ActivityPage
	json.Unmarshal(get("/entries?month=2026-09&search=New+purchase", 200), &filtered)
	if filtered.Total != 1 || filtered.Items[0].ID != id(300) {
		t.Fatal("search was applied after pagination")
	}
	json.Unmarshal(get("/entries?month=2026-09&account="+otherID, 200), &filtered)
	if filtered.Total != 1 || filtered.Items[0].Kind != "transfer" {
		t.Fatal("destination account filter lost transfer")
	}
	var inbox store.ReviewInbox
	json.Unmarshal(get("/assistant/inbox", 200), &inbox)
	if len(inbox.Items) != 50 || inbox.NextCursor == "" {
		t.Fatalf("inbox first page: %+v", inbox)
	}
	reviewed := map[string]bool{}
	for _, item := range inbox.Items {
		reviewed[item.EntryID] = true
	}
	exec(`UPDATE assistant_reviews SET status='dismissed' WHERE entry_id=$1`, inbox.Items[0].EntryID)
	cursor = inbox.NextCursor
	for cursor != "" {
		var page store.ReviewInbox
		json.Unmarshal(get("/assistant/inbox?cursor="+url.QueryEscape(cursor), 200), &page)
		for _, item := range page.Items {
			if reviewed[item.EntryID] {
				t.Fatal("duplicate inbox item")
			}
			reviewed[item.EntryID] = true
		}
		cursor = page.NextCursor
	}
	if len(reviewed) != 129 {
		t.Fatalf("review cursor skipped items: %d", len(reviewed))
	}
	get("/assistant/inbox?view=history&cursor="+url.QueryEscape(inbox.NextCursor), 400)
	get("/assistant/inbox?cursor=garbage", 400)
}
