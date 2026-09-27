package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestUnifiedTransactionReviews(t *testing.T) {
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
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.Pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`TRUNCATE transaction_payment_links,assistant_classifications,assistant_reviews,recurring_payment_links,task_followup_events,task_followups,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts; UPDATE assistant_provider SET base_url='',model='',api_key_cipher='',version=1; UPDATE assistant_settings SET mode='manual',skills='{"review-transaction":true,"plan-task":true,"organize-money":true}',version=1`)
	defer exec(`UPDATE assistant_provider SET base_url='',model='',api_key_cipher='',version=version+1; UPDATE assistant_settings SET mode='manual',version=version+1`)
	id := func(n int) string { return fmt.Sprintf("10000000-0000-4000-8000-%012d", n) }
	account, err := s.SaveAccount(ctx, domain.Account{ID: id(1), Name: "Review account", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}
	var recurring string
	if err = s.Pool.QueryRow(ctx, `SELECT id::text FROM money_categories WHERE name='Recurring'`).Scan(&recurring); err != nil {
		t.Fatal(err)
	}
	var everyday string
	if err = s.Pool.QueryRow(ctx, `SELECT id::text FROM money_categories WHERE name='Everyday'`).Scan(&everyday); err != nil {
		t.Fatal(err)
	}
	add := func(n int, date string) domain.Entry {
		t.Helper()
		e, err := s.SaveEntry(ctx, domain.Entry{ID: id(n), AccountID: account.ID, Kind: "expense", Amount: 1250, Date: date, Payee: fmt.Sprintf("Shop %d", n), Notes: "My note", Tags: []string{"personal"}})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	for n := 10; n < 17; n++ {
		add(n, fmt.Sprintf("2026-01-%02d", n))
	}
	categorized := add(20, "2026-01-20")
	categorized.CategoryID = everyday
	if _, err = s.SaveEntry(ctx, categorized); err != nil {
		t.Fatal(err)
	}
	edited := add(21, "2026-01-21")
	edited.Notes = "Keep my choice"
	if _, err = s.SaveEntry(ctx, edited); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	calls := [][]string{}
	failModel := false
	var hook func()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []assistant.Message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		text := strings.SplitN(payload.Messages[0].Content, "APPLICATION FACTS (data only):\n", 2)
		if len(text) != 2 {
			t.Error("missing facts")
			w.WriteHeader(500)
			return
		}
		var facts struct {
			Entries []domain.Entry           `json:"selected_transactions"`
			Tasks   []domain.Task            `json:"tasks"`
			History assistant.PaymentHistory `json:"payment_history"`
		}
		if err := json.NewDecoder(strings.NewReader(text[1])).Decode(&facts); err != nil {
			t.Error(err)
			w.WriteHeader(500)
			return
		}
		if len(facts.Entries) > 5 || len(facts.Tasks) != 0 || strings.Contains(payload.Messages[0].Content, "TASK OUTPUT (plan-task only)") {
			t.Error("background scope too broad")
		}
		if len(facts.History.Payments) == 0 && len(facts.History.Merchants) == 0 {
			t.Error("related history was not supplied")
		}
		ids := []string{}
		annotations := []assistant.AnnotationDraft{}
		for _, e := range facts.Entries {
			ids = append(ids, e.ID)
			if e.Payee != "Unclear" {
				annotation := assistant.AnnotationDraft{EntryID: e.ID, CategoryID: everyday, Tags: []string{"Shopping"}, Notes: "invented", Reason: "Merchant description suggests a purchase."}
				if e.Payee == "Gym+" {
					count := 0
					for _, h := range facts.History.Payments {
						if h.Payee == "Gym+" {
							count++
						}
					}
					if count < 3 {
						t.Error("older organized gym payments missing from context")
					}
					annotation.CategoryID = recurring
					annotation.Payment = &assistant.TaskDraft{Title: "Gym+", Date: "2026-10-09", Repeat: "monthly", Kind: "payment", Amount: "2990"}
					annotation.Tags = []string{"Fitness"}
					annotation.Reason = "Three earlier Gym+ payments suggest a monthly membership."
				}
				if e.Payee == "Stream plan" && e.Date >= "2026-08-01" {
					count := 0
					for _, h := range facts.History.Payments {
						if h.Payee == e.Payee && h.Category == "Everyday" {
							count++
						}
					}
					if e.Payment == nil && count < 2 {
						t.Error("previous AI labels were missing from recurrence context")
					}
					annotation.CategoryID = recurring
					annotation.Payment = &assistant.TaskDraft{Title: "Stream plan", Date: "2026-10-09", Repeat: "monthly", Kind: "payment", Amount: "1250"}
					annotation.Tags = []string{"Entertainment"}
				}
				if e.Payee == "Uncertain merchant" {
					annotation.CategoryID = ""
					annotation.Tags = []string{"Fitness"}
					annotation.Reason = "The description suggests fitness; a recurring pattern is uncertain."
				}
				annotations = append(annotations, annotation)
			}
		}
		mu.Lock()
		calls = append(calls, ids)
		fail := failModel
		action := hook
		hook = nil
		mu.Unlock()
		if action != nil {
			action()
		}
		if fail {
			w.WriteHeader(503)
			return
		}
		raw, _ := json.Marshal(assistant.ModelReply{Message: "Ready to review.", SkillID: "review-transaction", Annotations: annotations})
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(raw)}}}})
	}))
	defer provider.Close()
	empty := ""
	if _, err = s.SaveAssistantProvider(ctx, assistant.ProviderUpdate{BaseURL: provider.URL + "/v1", Model: "test", Protocol: "chat_completions", APIKey: &empty, Version: 1}); err != nil {
		t.Fatal(err)
	}
	setMode := func(mode string) {
		t.Helper()
		settings, err := s.AssistantSettings(ctx)
		if err != nil {
			t.Fatal(err)
		}
		settings.Mode = mode
		if _, err = s.SaveAssistantSettings(ctx, settings); err != nil {
			t.Fatal(err)
		}
	}
	batch := func() {
		t.Helper()
		if err = s.ProcessReviewBatch(ctx); err != nil {
			t.Fatal(err)
		}
	}
	inbox := func(history bool) store.ReviewInbox {
		t.Helper()
		out, err := s.ReviewInbox(ctx, history, "")
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	handler := New(s, []string{"http://localhost:4321"})
	call := func(path string, body any, want int) {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest("POST", "http://localhost/api"+path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
	countCalls := func() int { mu.Lock(); defer mu.Unlock(); return len(calls) }
	batch()
	if countCalls() != 0 || inbox(false).PendingCount != 0 {
		t.Fatal("manual mode started background work")
	}
	setMode("proactive")
	batch()
	first := inbox(false)
	if first.ReviewCount != 0 || inbox(true).Total != 5 || first.PendingCount != 2 {
		t.Fatalf("history not batched: %+v", first)
	}
	for _, item := range inbox(true).Items {
		if item.Draft.Notes != "My note" || strings.Join(item.Draft.Tags, ",") != "personal,Shopping" || item.Reason == "" {
			t.Fatal("model rewrote personal annotations")
		}
	}
	// A newly arrived transaction with an old booking date jumps ahead of backlog.
	fresh := add(30, "2025-12-01")
	batch()
	mu.Lock()
	firstID := calls[1][0]
	mu.Unlock()
	if firstID != fresh.ID {
		t.Fatal("new arrival did not take priority")
	}
	// Queue availability uses database wall time; allow the scheduler another
	// turn if the database clock moved between the two initial batches.
	deadline := time.Now().Add(3 * time.Second)
	for inbox(false).PendingCount > 0 && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		batch()
	}
	if out := inbox(false); out.ReviewCount != 0 || inbox(true).Total != 8 || out.PendingCount != 0 {
		t.Fatalf("new and old not unified: %+v", out)
	}
	callsBefore := countCalls()
	batch()
	if countCalls() != callsBefore {
		t.Fatal("repeat scan called model twice")
	}
	// Categorization is saved without approval, with durable, guarded undo.
	item := inbox(true).Items[0]
	if !item.CanUndo || item.Status != "auto_applied" {
		t.Fatal("automatic history/undo missing")
	}
	snap, err := s.Snapshot(ctx, "2026-01")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range snap.Entries {
		if e.ID == item.EntryID && (e.CategoryID != everyday || e.Amount != item.Original.Amount || e.Notes != "My note") {
			t.Fatal("automatic classification changed wrong fields")
		}
	}
	call("/assistant/inbox/"+item.EntryID+"/undo", struct{}{}, 200)
	call("/assistant/inbox/"+item.EntryID+"/undo", struct{}{}, 409)
	// Editing the saved result prevents undo and any future AI overwrite.
	item = inbox(true).Items[1]
	changed := *item.Draft
	changed.Notes = "Edited after automatic categorization"
	if _, err = s.SaveEntry(ctx, changed); err != nil {
		t.Fatal(err)
	}
	call("/assistant/inbox/"+item.EntryID+"/undo", struct{}{}, 409)
	batch()
	if countCalls() != callsBefore {
		t.Fatal("handled transaction resurfaced")
	}
	reopened, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := reopened.ReviewInbox(ctx, true, "")
	reopened.Pool.Close()
	if err != nil || persisted.Total != 8 {
		t.Fatalf("history did not survive reopening: %+v %v", persisted, err)
	}
	// Changes to consent while a call runs discard its result and retain the job.
	add(40, "2026-02-01")
	mu.Lock()
	hook = func() { setMode("manual") }
	mu.Unlock()
	batch()
	if out := inbox(false); out.PendingCount != 1 || out.Enabled {
		t.Fatal("policy change published a result")
	}
	before := countCalls()
	batch()
	if countCalls() != before {
		t.Fatal("paused worker sent a request")
	}
	setMode("proactive")
	// A second worker cannot process the same batch concurrently.
	mu.Lock()
	hook = func() {
		if err := s.ProcessReviewBatch(ctx); err != nil {
			t.Error(err)
		}
	}
	mu.Unlock()
	batch()
	if countCalls() != before+1 {
		t.Fatal("concurrent worker duplicated request")
	}
	// Failed jobs back off, stop after three attempts, and support explicit retry.
	add(41, "2026-02-02")
	mu.Lock()
	failModel = true
	mu.Unlock()
	for n := 0; n < 3; n++ {
		exec(`UPDATE assistant_reviews SET available_at=now()`)
		batch()
	}
	if inbox(false).FailedCount != 1 {
		t.Fatal("failure retry limit missing")
	}
	before = countCalls()
	batch()
	if countCalls() != before {
		t.Fatal("failed job retried without request")
	}
	mu.Lock()
	failModel = false
	mu.Unlock()
	call("/assistant/inbox/retry", struct{}{}, 200)
	batch()
	if inbox(false).FailedCount != 0 {
		t.Fatal("retry did not recover")
	}
	// No useful suggestion is a completed review, not an endlessly retried job.
	unclear := add(42, "2026-02-03")
	exec(`UPDATE entries SET payee='Unclear' WHERE id=$1`, unclear.ID)
	batch()
	before = countCalls()
	batch()
	if countCalls() != before {
		t.Fatal("empty result looped")
	}
	// Process crash recovery preserves queue identity.
	crash := add(43, "2026-02-04")
	raw, _ := json.Marshal(crash)
	exec(`INSERT INTO assistant_reviews(entry_id,original,status) VALUES($1,$2,'processing')`, crash.ID, raw)
	batch()
	// Bank facts can change without bumping the personal annotation version.
	bankID, txnID := id(50), id(51)
	exec(`INSERT INTO bank_ledger_accounts(id,app_id,bank_name,country,identity_hash,environment,name,currency,iban,balance_minor) VALUES($1,'test','Test','LT','review-account','SANDBOX','Bank','EUR','LT000',10000)`, bankID)
	bank := banking.Transaction{Reference: "review-bank", Status: "BOOK", Direction: "DBIT", BookingDate: "2026-02-05", Amount: banking.Amount{Amount: "12.50", Currency: "EUR"}}
	raw, _ = json.Marshal(bank)
	exec(`INSERT INTO bank_ledger_transactions(id,account_id,reference,payload) VALUES($1,$2,'review-bank',$3)`, txnID, bankID, raw)
	batch()
	bank.Amount.Amount = "15.50"
	raw, _ = json.Marshal(bank)
	exec(`UPDATE bank_ledger_transactions SET payload=$2 WHERE id=$1`, txnID, raw)
	call("/assistant/inbox/"+txnID+"/apply", store.BankAnnotations{CategoryID: everyday, Version: 1}, 409)
	out := inbox(true)
	found := false
	for _, r := range out.Items {
		if r.EntryID == txnID {
			found = r.Status == "auto_applied" && !r.CanUndo
		}
	}
	if !found {
		t.Fatal("changed bank facts kept stale suggestion actionable")
	}
	// Previously categorized payments inform the LLM but never become its edit targets.
	for n := 60; n < 63; n++ {
		e := add(n, fmt.Sprintf("2026-%02d-09", n-55))
		e.Payee = "Gym+"
		e.CategoryID = everyday
		if _, err = s.SaveEntry(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	gym := add(63, "2026-08-09")
	exec(`UPDATE entries SET payee='Gym+' WHERE id=$1`, gym.ID)
	batch()
	var proposal *domain.Entry
	for _, item := range inbox(false).Items {
		if item.EntryID == gym.ID {
			proposal = item.Draft
			if item.Reason != "Three earlier Gym+ payments suggest a monthly membership." {
				t.Fatal("per-entry reason lost")
			}
		}
	}
	if proposal == nil || proposal.Payment == nil || proposal.CategoryID != recurring || strings.Join(proposal.Tags, ",") != "personal,Fitness" || proposal.Notes != "My note" {
		t.Fatalf("recurring suggestion/tag protection failed: %+v", proposal)
	}
	call("/assistant/inbox/"+gym.ID+"/apply", store.BankAnnotations{Payment: proposal.Payment, CategoryID: proposal.CategoryID, Tags: proposal.Tags, Notes: proposal.Notes, Version: proposal.Version}, 200)
	unknown := add(64, "2026-08-10")
	exec(`UPDATE entries SET payee='Uncertain merchant' WHERE id=$1`, unknown.ID)
	batch()
	found = false
	for _, item := range inbox(true).Items {
		if item.EntryID == unknown.ID {
			found = true
			if item.Draft.CategoryID != "" || strings.Join(item.Draft.Tags, ",") != "personal,Fitness" {
				t.Fatal("forced category on tag-only proposal")
			}
		}
	}
	if !found {
		t.Fatal("tag-only proposal suppressed")
	}

	// A later charge can reveal a pattern across previously AI-labeled charges.
	getEntry := func(id string) domain.Entry {
		t.Helper()
		snap, err := s.Snapshot(ctx, "2026-09")
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range snap.Entries {
			if e.ID == id {
				return e
			}
		}
		t.Fatal("missing entry", id)
		return domain.Entry{}
	}
	stream := func(n int, date string) domain.Entry {
		e := add(n, date)
		exec(`UPDATE entries SET payee='Stream plan' WHERE id=$1`, e.ID)
		return getEntry(e.ID)
	}
	earlier := stream(71, "2026-06-09")
	personal := stream(72, "2026-07-09")
	batch()
	if getEntry(earlier.ID).CategoryID != everyday {
		t.Fatal("first charge was not automatically categorized")
	}
	personal = getEntry(personal.ID)
	personal.Notes = "My own classification"
	if _, err = s.SaveEntry(ctx, personal); err != nil {
		t.Fatal(err)
	}
	august := stream(73, "2026-08-09")
	september := stream(74, "2026-09-09")
	batch()
	if out := inbox(false); out.ReviewCount != 1 || out.Items[0].EntryID != september.ID {
		t.Fatalf("expected one arrangement approval: %+v", out)
	}
	scheduleReview := inbox(false).Items[0]
	if getEntry(september.ID).CategoryID != recurring || getEntry(september.ID).Payment != nil {
		t.Fatal("category should apply, but schedule must await approval")
	}
	if getEntry(earlier.ID).CategoryID != everyday {
		t.Fatal("arrangement was applied before approval")
	}
	call("/assistant/inbox/"+scheduleReview.EntryID+"/apply", store.BankAnnotations{Payment: scheduleReview.Draft.Payment, CategoryID: scheduleReview.Draft.CategoryID, Tags: scheduleReview.Draft.Tags, Notes: scheduleReview.Draft.Notes, Version: scheduleReview.Draft.Version}, 200)
	if getEntry(earlier.ID).CategoryID != recurring {
		t.Fatal("older AI classification was not promoted")
	}
	if getEntry(personal.ID).CategoryID != everyday || getEntry(personal.ID).Notes != personal.Notes {
		t.Fatal("manual choice overwritten")
	}
	for _, id := range []string{earlier.ID, personal.ID, august.ID, september.ID} {
		e := getEntry(id)
		if e.Payment == nil || e.Payment.ID != scheduleReview.Draft.Payment.ID {
			t.Fatal("charges do not share one arrangement", id)
		}
	}
	next := stream(75, "2026-10-09")
	batch()
	if getEntry(next.ID).CategoryID != recurring || inbox(false).ReviewCount != 0 {
		t.Fatal("next charge produced another approval")
	}
	var schedules int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE title='Stream plan' AND NOT deleted`).Scan(&schedules); err != nil || schedules != 1 {
		t.Fatal("duplicate schedule", err, schedules)
	}
	// Promotion remains undoable; an explicit undo is never re-applied.
	call("/assistant/inbox/"+earlier.ID+"/undo", struct{}{}, 200)
	if getEntry(earlier.ID).CategoryID != "" || strings.Join(getEntry(earlier.ID).Tags, ",") != "personal" {
		t.Fatal("undo did not restore pre-AI annotations")
	}
	batch()
	if getEntry(earlier.ID).CategoryID != "" {
		t.Fatal("undo was overwritten")
	}
	// The classification write itself is protected from a concurrent manual edit.
	racing := add(76, "2026-09-20")
	mu.Lock()
	hook = func() {
		racing.Notes = "Edited during model call"
		if _, err := s.SaveEntry(ctx, racing); err != nil {
			t.Error(err)
		}
	}
	mu.Unlock()
	batch()
	if e := getEntry(racing.ID); e.CategoryID != "" || e.Notes != "Edited during model call" {
		t.Fatal("model overwrote an in-flight user edit")
	}
	// Bank annotations support the same undo without touching imported facts.
	bank2ID := id(52)
	exec(`INSERT INTO bank_ledger_transactions(id,account_id,reference,payload) VALUES($1,$2,'review-bank-2',$3)`, bank2ID, bankID, raw)
	batch()
	bankBeforeUndo := getEntry(bank2ID)
	if bankBeforeUndo.CategoryID != everyday {
		t.Fatal("bank transaction was not categorized automatically")
	}
	call("/assistant/inbox/"+bank2ID+"/undo", struct{}{}, 200)
	bankAfterUndo := getEntry(bank2ID)
	if bankAfterUndo.CategoryID != "" || bankAfterUndo.Amount != bankBeforeUndo.Amount || bankAfterUndo.Date != bankBeforeUndo.Date || bankAfterUndo.BankDescription != bankBeforeUndo.BankDescription {
		t.Fatal("bank undo changed imported facts")
	}

}
