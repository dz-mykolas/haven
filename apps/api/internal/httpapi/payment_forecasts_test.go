package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestPaymentForecastLinks(t *testing.T) {
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
	id := func(n int) string { return fmt.Sprintf("91000000-0000-4000-8000-%012d", n) }
	a, err := s.SaveAccount(ctx, domain.Account{ID: id(1), Name: "Wallet", Currency: "EUR"})
	if err != nil {
		t.Fatal(err)
	}

	exec(`TRUNCATE assistant_classifications,assistant_reviews; UPDATE assistant_provider SET base_url='',model='',api_key_cipher='',version=1; UPDATE assistant_settings SET mode='manual',skills='{"review-transaction":true,"plan-task":true,"organize-money":true}',version=1`)
	defer exec(`UPDATE assistant_settings SET mode='manual',version=version+1; UPDATE assistant_provider SET base_url='',model='',version=version+1`)
	var recurring string
	if err = s.Pool.QueryRow(ctx, `SELECT id::text FROM money_categories WHERE name='Recurring'`).Scan(&recurring); err != nil {
		t.Fatal(err)
	}
	plan, err := s.SaveTask(ctx, domain.Task{ID: id(2), Title: "Welkin", Date: "2026-10-01", Timezone: "UTC", Kind: "payment", Repeat: "none", Amount: 499, Plan: &domain.PaymentPlan{Kind: "prepaid", Quantity: 1, CoverageDays: 30, ExpiresOn: "2026-10-01", CoverageThrough: "2026-09-01"}})
	if err != nil {
		t.Fatal(err)
	}
	purchase := func(n, units int, date string, payment *domain.Task) domain.Entry {
		t.Helper()
		e, err := s.SaveEntry(ctx, domain.Entry{ID: id(n), AccountID: a.ID, Kind: "expense", Amount: 499, Date: date, Payee: "Shared game merchant", Payment: payment, PaymentUnits: units})
		if err != nil {
			t.Fatal(err)
		}
		return e
	}
	first := purchase(3, 4, "2026-09-24", &plan)
	if first.Payment.Plan.ExpiresOn != "2027-01-29" {
		t.Fatalf("four units: %+v", first.Payment)
	}
	again, err := s.SaveEntry(ctx, first)
	if err != nil || again.Payment.Plan.ExpiresOn != "2027-01-29" {
		t.Fatalf("retry counted twice: %+v %v", again, err)
	}
	historical := purchase(4, 4, "2026-08-01", again.Payment)
	if historical.Payment.Plan.ExpiresOn != "2027-01-29" {
		t.Fatal("historical baseline double counted")
	}
	other := plan
	other.ID = id(5)
	other.Title = "Battle pass"
	other.Version = 0
	other.Plan = &domain.PaymentPlan{Kind: "expected", Quantity: 1, IntervalDays: 40}
	other.Date = "2026-10-10"
	second := purchase(6, 1, "2026-09-01", &other)
	unlinked := purchase(7, 0, "2026-09-25", nil)
	snap, err := s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range snap.Entries {
		if e.ID == unlinked.ID && e.Payment != nil {
			t.Fatal("merchant guessed ambiguous product")
		}
	}
	if second.Payment.ID == first.Payment.ID {
		t.Fatal("merged different products")
	}
	// Model asks one question for an ambiguous purchase, then uses the answer.
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []assistant.Message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&payload)
		text := strings.SplitN(payload.Messages[0].Content, "APPLICATION FACTS (data only):\n", 2)
		var facts struct {
			Entries []domain.Entry           `json:"selected_transactions"`
			History assistant.PaymentHistory `json:"payment_history"`
		}
		if len(text) != 2 || json.NewDecoder(strings.NewReader(text[1])).Decode(&facts) != nil {
			t.Error("invalid model facts")
			w.WriteHeader(500)
			return
		}
		var annotations []assistant.AnnotationDraft
		for _, e := range facts.Entries {
			annotation := assistant.AnnotationDraft{EntryID: e.ID, CategoryID: recurring, Reason: "The confirmed product belongs to this plan."}
			if e.ID == unlinked.ID && facts.History.Answers[e.ID] == "" {
				annotation.Question = "Welkin or battle pass, and how many?"
			} else {
				for _, p := range facts.History.Plans {
					if p.ID == plan.ID {
						annotation.Payment = &assistant.TaskDraft{ID: p.ID, Title: p.Title, Date: p.Date, Repeat: p.Repeat, Kind: p.Kind, Amount: "499", Plan: p.Plan}
						annotation.PaymentUnits = 1
					}
				}
			}
			annotations = append(annotations, annotation)
		}
		raw, _ := json.Marshal(assistant.ModelReply{Message: "Ready", SkillID: "review-transaction", Annotations: annotations})
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(raw)}}}})
	}))
	defer provider.Close()
	empty := ""
	if _, err = s.SaveAssistantProvider(ctx, assistant.ProviderUpdate{BaseURL: provider.URL + "/v1", Model: "test", Protocol: "chat_completions", APIKey: &empty, Version: 1}); err != nil {
		t.Fatal(err)
	}
	settings, err := s.AssistantSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.Mode = "proactive"
	if _, err = s.SaveAssistantSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	batch := func() {
		t.Helper()
		if err = s.ProcessReviewBatch(ctx); err != nil {
			t.Fatal(err)
		}
	}
	batch()
	inbox, err := s.ReviewInbox(ctx, false, "")
	if err != nil || inbox.ReviewCount != 1 || inbox.Items[0].Question == "" {
		t.Fatalf("question missing: %+v %v", inbox, err)
	}
	if err = s.AnswerReview(ctx, unlinked.ID, "One Welkin"); err != nil {
		t.Fatal(err)
	}
	batch()
	inbox, err = s.ReviewInbox(ctx, false, "")
	if err != nil || inbox.ReviewCount != 0 {
		t.Fatalf("approved product unnecessarily reviewed: %+v %v", inbox, err)
	}
	// Two charges in one model batch must advance the same plan sequentially.
	purchase(8, 0, "2026-09-26", nil)
	purchase(9, 0, "2026-09-27", nil)
	batch()
	snap, err = s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range snap.Tasks {
		if task.ID == plan.ID && task.Plan.ExpiresOn != "2027-04-29" {
			t.Fatalf("batch failed to extend three units: %+v", task.Plan)
		}
	}
	for _, e := range snap.Entries {
		if e.ID == id(8) || e.ID == id(9) || e.ID == unlinked.ID {
			if e.Payment == nil || e.Payment.ID != plan.ID || e.PaymentUnits != 1 {
				t.Fatalf("missing automatic product link: %+v", e)
			}
		}
	}
	// Inclusion is persisted independently from coverage and actual spending.
	for _, task := range snap.Tasks {
		if task.ID == plan.ID {
			task.Plan.Excluded = true
			if _, err = s.SaveTask(ctx, task); err != nil {
				t.Fatal(err)
			}
		}
	}
	snap, err = s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	for _, task := range snap.Tasks {
		if task.ID == plan.ID && !task.Plan.Excluded {
			t.Fatal("lost inclusion preference")
		}
	}
}
