package assistant

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

func TestReviewHistoryScopeAndBounds(t *testing.T) {
	target := domain.Entry{ID: "target", Payee: "Gym+", Kind: "expense", Date: "2026-09-09", Amount: 2990}
	old := domain.Entry{ID: "old", AccountID: "other-account", Payee: "GYM +", Kind: "expense", Date: "2025-09-09", Amount: 2990, Category: "Recurring", Tags: []string{"Fitness"}, Notes: "PRIVATE historical note", Version: 7}
	all := []domain.Entry{target, old, {ID: "deleted", Payee: "Gym+", Kind: "expense", Deleted: true}, {ID: "transfer", Payee: "Gym+", Kind: "transfer"}}
	for i := 0; i < 250; i++ {
		all = append(all, domain.Entry{ID: fmt.Sprint(i), Payee: "Other merchant", Kind: "expense", Date: "2026-09-01", BankDescription: strings.Repeat("x", 1000)})
	}
	history := ReviewHistory([]domain.Entry{target}, all)
	if len(history.Payments) != 41 || !history.Truncated {
		t.Fatalf("history scope: %d %v", len(history.Payments), history.Truncated)
	}
	if history.Payments[0].ID != "old" || history.Payments[0].AccountID != "other-account" || history.Payments[0].Category != "Recurring" {
		t.Fatal("related organized payment lost behind newer unrelated activity")
	}
	for _, e := range history.Payments {
		if e.ID == "target" || e.ID == "deleted" || e.ID == "transfer" || len([]rune(e.Description)) > 401 {
			t.Fatal("out-of-scope context")
		}
	}
	raw, _ := json.Marshal(history)
	if strings.Contains(string(raw), "PRIVATE") {
		t.Fatal("historical personal notes leaked")
	}
	if len(ReviewHistory(nil, all).Payments) != 0 {
		t.Fatal("history exposed without targets")
	}
	// Retrieval does not decide recurring or annotate records, even with many matches.
	all = nil
	for i := 0; i < 400; i++ {
		all = append(all, domain.Entry{ID: fmt.Sprint(i), Payee: fmt.Sprintf("Merchant %d", i%5), Kind: "expense", Date: "2026-09-01"})
	}
	selected := []domain.Entry{}
	for i := 0; i < 5; i++ {
		selected = append(selected, domain.Entry{ID: fmt.Sprintf("t%d", i), Payee: fmt.Sprintf("Merchant %d", i)})
	}
	history = ReviewHistory(selected, all)
	if len(history.Payments) > 140 || !history.Truncated {
		t.Fatal("unbounded context")
	}
}
func TestReviewValidationAndTagPreservation(t *testing.T) {
	settings := Defaults()
	settings.Mode = "proactive"
	settings.Skills["plan-task"] = false
	settings.Skills["organize-money"] = false
	entry := domain.Entry{ID: "current", Payee: "Gym+", Tags: []string{"Personal"}, Amount: 2990}
	categories := []domain.Category{{ID: "recurring", Name: "Recurring"}}
	model := ModelReply{Message: "Ready.", SkillID: "review-transaction", Annotations: []AnnotationDraft{{EntryID: "current", CategoryID: "recurring", Tags: []string{"Fitness"}, Reason: "The supplied payments appear monthly."}}}
	parse := func() (ChatReply, error) {
		raw, _ := json.Marshal(model)
		return ParseReviewReply(string(raw), settings, []domain.Entry{entry}, categories)
	}
	reply, err := parse()
	if err != nil || reply.Reasons["current"] == "" || reply.Entries[0].Amount != 2990 {
		t.Fatalf("valid pattern suggestion rejected: %v", err)
	}
	model.Annotations[0].EntryID = "history-only"
	if _, err = parse(); err == nil {
		t.Fatal("model annotated read-only history")
	}
	model.Annotations[0].EntryID = "current"
	model.Annotations[0].Reason = ""
	if _, err = parse(); err == nil {
		t.Fatal("missing reason accepted")
	}
	model.Annotations[0].Reason = strings.Repeat("x", 401)
	if _, err = parse(); err == nil {
		t.Fatal("unbounded explanation")
	}
	tags := ReviewTags([]string{"Personal"}, []string{" personal ", "fitness", " fitness "}, []string{"Fitness"})
	if strings.Join(tags, ",") != "Personal,Fitness" {
		t.Fatalf("tag merge: %v", tags)
	}
	existing := []string{}
	for i := 0; i < 12; i++ {
		existing = append(existing, fmt.Sprint(i))
	}
	if got := ReviewTags(existing, []string{"Fitness"}, nil); strings.Join(got, ",") != strings.Join(existing, ",") {
		t.Fatal("existing tags lost at capacity")
	}
	// The model chooses tag-only proposals too; uncertainty need not force a category.
	model.Annotations[0].Reason = "Merchant name suggests fitness; the sample is too limited for a schedule."
	model.Annotations[0].CategoryID = ""
	reply, err = parse()
	if err != nil || reply.Entries[0].CategoryID != "" {
		t.Fatal("tag-only suggestion rejected")
	}
	prompt := ReviewPrompt(settings, []domain.Entry{entry}, categories, nil, ReviewHistory([]domain.Entry{entry}, nil))
	if !strings.Contains(prompt, "payment_history") || !strings.Contains(prompt, "judge") && !strings.Contains(prompt, "Judge") {
		t.Fatal("history/LLM judgment missing")
	}
	settings.Skills["review-transaction"] = false
	if strings.Contains(ChatPrompt(settings, "UTC", nil, nil, nil, nil, PaymentHistory{}), "payment_history") {
		t.Fatal("history exposed with review skill disabled")
	}
}

func TestRecurringPaymentDraftValidation(t *testing.T) {
	settings := Defaults()
	settings.Mode = "proactive"
	entry := domain.Entry{ID: "selected", Kind: "expense", Payee: "Netflix", Amount: 1599, Version: 2, CategoryID: "recurring", Category: "Recurring"}
	categories := []domain.Category{{ID: "recurring", Name: "Recurring"}}
	payment := &TaskDraft{Title: "Netflix", Date: "2026-10-07", Repeat: "monthly", Kind: "payment", Amount: "1599"}
	model := ModelReply{Message: "Review the next payment.", SkillID: "review-transaction", Annotations: []AnnotationDraft{{EntryID: entry.ID, CategoryID: "recurring", Reason: "The history supports monthly payments around the seventh.", Payment: payment}}}
	parse := func() (ChatReply, error) {
		raw, _ := json.Marshal(model)
		return ParseReviewReply(string(raw), settings, []domain.Entry{entry}, categories)
	}
	reply, err := parse()
	if err != nil || reply.Entries[0].Payment == nil || reply.Entries[0].Payment.Repeat != "monthly" || reply.Entries[0].Payment.Amount != 1599 || reply.Entries[0].Payment.Version != 0 || !domain.ValidID(reply.Entries[0].Payment.ID) {
		t.Fatalf("missing editable payment draft: %+v %v", reply, err)
	}
	payment.ID = "unrelated-task"
	if _, err = parse(); err == nil {
		t.Fatal("model can edit unrelated task")
	}
	payment.ID = ""
	entry.Kind = "income"
	if _, err = parse(); err == nil {
		t.Fatal("scheduled an outgoing payment for income")
	}
	entry.Kind = "expense"
	payment.Repeat = "none"
	if _, err = parse(); err == nil {
		t.Fatal("recurring draft without recurrence accepted")
	}
	payment.Repeat = "yearly"
	if _, err = parse(); err != nil {
		t.Fatal("annual subscription rejected", err)
	}
	entry.Payment = reply.Entries[0].Payment
	entry.Payment.Version = 3
	payment.ID = entry.Payment.ID
	payment.Amount = "9999"
	reply, err = parse()
	if err != nil || reply.Entries[0].Payment.Amount != 1599 || reply.Entries[0].Payment.Version != 3 {
		t.Fatal("review replaced an accepted schedule")
	}
}
