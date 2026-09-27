package assistant

import (
	"encoding/json"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"testing"
)

func TestDraftValidation(t *testing.T) {
	settings := Defaults()
	settings.Mode = "on_request"
	model := ModelReply{Message: "Review this draft", SkillID: "plan-task", Task: &TaskDraft{Title: "Haircut", Date: "2026-09-25", Time: "16:30", Repeat: "none", Kind: "appointment", Amount: "0"}}
	parse := func(m ModelReply, tasks []domain.Task, entries []domain.Entry, categories []domain.Category) (ChatReply, error) {
		raw, _ := json.Marshal(m)
		return ParseReply(string(raw), settings, "Europe/Vilnius", tasks, entries, categories)
	}
	reply, err := parse(model, nil, nil, nil)
	if err != nil || reply.Task == nil || reply.Task.Version != 0 || reply.Task.ID == "" || reply.Task.Timezone != "Europe/Vilnius" {
		t.Fatalf("invalid new task: %+v %v", reply, err)
	}
	model.Task.Amount = "0.25"
	if _, err = parse(model, nil, nil, nil); err == nil {
		t.Fatal("accepted fractional cents")
	}
	model.Task.Amount = "0"
	model.Task.ID = "invented"
	if _, err = parse(model, nil, nil, nil); err == nil {
		t.Fatal("accepted invented task ID")
	}
	model.Task.ID = "71000000-0000-4000-8000-000000000001"
	model.Task.Date = "2027-02-28"
	model.Task.Repeat = "monthly"
	old := domain.Task{ID: "71000000-0000-4000-8000-000000000001", Date: "2027-02-28", AnchorDay: 31, Repeat: "monthly", Timezone: "Europe/Vilnius", Version: 4}
	reply, err = parse(model, []domain.Task{old}, nil, nil)
	if err != nil || reply.Task.AnchorDay != 31 || reply.Task.Version != 4 {
		t.Fatalf("lost recurring anchor/version: %+v %v", reply, err)
	}
	settings.Skills["plan-task"] = false
	if _, err = parse(model, []domain.Task{old}, nil, nil); err == nil {
		t.Fatal("accepted disabled skill")
	}
	settings.Skills["plan-task"] = true
	entry := domain.Entry{ID: "selected", Amount: 1299, Payee: "Netflix", Version: 7, Source: "bank"}
	model = ModelReply{Message: "Review the category", SkillID: "review-transaction", Annotations: []AnnotationDraft{{EntryID: "selected", CategoryID: "recurring", Tags: []string{"shared"}, Notes: "Monthly plan"}}}
	reply, err = parse(model, nil, []domain.Entry{entry}, []domain.Category{{ID: "recurring", Name: "Recurring"}})
	if err != nil || len(reply.Entries) != 1 {
		t.Fatalf("annotation failed: %v", err)
	}
	e := reply.Entries[0]
	if e.Amount != entry.Amount || e.Payee != entry.Payee || e.Version != 7 || e.Source != "bank" || e.Category != "Recurring" {
		t.Fatalf("financial fields changed: %+v", e)
	}
	model.Annotations[0].EntryID = "unselected"
	if _, err = parse(model, nil, []domain.Entry{entry}, nil); err == nil {
		t.Fatal("accepted unselected transaction")
	}
	if _, err = ParseReply(`{"message":"hello","skill_id":"plan-task","execute":"delete"}`, settings, "UTC", nil, nil, nil); err == nil {
		t.Fatal("accepted unknown output")
	}
}

func TestUnsavedAppointmentFollowUp(t *testing.T) {
	settings := Defaults()
	settings.Mode = "on_request"
	first := `{"message":"Review the dentist appointment","skill_id":"plan-task","task":{"id":"","title":"Dentist appointment","date":"2026-10-02","time":"","repeat":"none","kind":"appointment","amount_minor":"0","notes":"Bring insurance card"},"annotations":[]}`
	initial, err := ParseReply(first, settings, "Europe/Vilnius", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	drafts, err := ResolveTaskDrafts([]domain.Task{*initial.Task}, nil)
	if err != nil {
		t.Fatal(err)
	}
	model := ModelReply{Message: "The estimate is in the appointment note", SkillID: "plan-task", Task: &TaskDraft{ID: initial.Task.ID, Title: initial.Task.Title, Date: initial.Task.Date, Repeat: "none", Kind: "appointment", Amount: "5000", Notes: "Bring insurance card"}}
	raw, _ := json.Marshal(model)
	updated, err := ParseReply(string(raw), settings, "Europe/Vilnius", drafts, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Task.ID != initial.Task.ID || updated.Task.Version != 0 || updated.Task.Kind != "appointment" || updated.Task.Amount != 0 || updated.Task.Notes != "Bring insurance card" || updated.Task.EstimatedMin == nil || *updated.Task.EstimatedMin != 5000 || *updated.Task.EstimatedMax != 5000 {
		t.Fatalf("lost or misclassified appointment: %+v", updated.Task)
	}
	if updated.Task.Date != initial.Task.Date || updated.Task.Time != "" {
		t.Fatal("follow-up altered date or unspecified time")
	}
	model.Task.Notes = updated.Task.Notes
	model.Task.Amount = "6000"
	raw, _ = json.Marshal(model)
	updated, err = ParseReply(string(raw), settings, "Europe/Vilnius", drafts, nil, nil)
	if err != nil || updated.Task.Notes != "Bring insurance card" || updated.Task.EstimatedMin == nil || *updated.Task.EstimatedMin != 6000 {
		t.Fatalf("estimate update failed: %+v %v", updated.Task, err)
	}
	for _, amount := range []string{"-5000", "5000.5", "9000000000001"} {
		model.Task.Amount = amount
		raw, _ = json.Marshal(model)
		if _, err := ParseReply(string(raw), settings, "Europe/Vilnius", drafts, nil, nil); err == nil {
			t.Fatalf("accepted invalid estimate %s", amount)
		}
	}
	existing := *initial.Task
	existing.Version = 2
	if _, err := ResolveTaskDrafts(drafts, []domain.Task{existing}); err == nil {
		t.Fatal("draft bypassed saved version")
	}
	drafts[0].Version = 2
	if _, err := ResolveTaskDrafts(drafts, nil); err == nil {
		t.Fatal("trusted missing saved task")
	}
	drafts[0].Version = 0
	drafts[0].Deleted = true
	if _, err := ResolveTaskDrafts(drafts, nil); err == nil {
		t.Fatal("trusted deleted draft")
	}
}

func TestAppointmentRangeDraft(t *testing.T) {
	settings := Defaults()
	settings.Mode = "on_request"
	raw := `{"message":"Ready to review.","skill_id":"plan-task","task":{"id":"","title":"Dentist","date":"2026-10-03","time":"","repeat":"none","kind":"appointment","amount_minor":"0","estimated_min_minor":"6000","estimated_max_minor":"7000","notes":"Bring insurance card\nEstimated cost: €60–70"},"annotations":[]}`
	reply, err := ParseReply(raw, settings, "Europe/Vilnius", nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reply.Task.EstimatedMin == nil || *reply.Task.EstimatedMin != 6000 || *reply.Task.EstimatedMax != 7000 || reply.Task.Amount != 0 || reply.Task.Notes != "Bring insurance card" {
		t.Fatalf("range not structured: %+v", reply.Task)
	}
}
