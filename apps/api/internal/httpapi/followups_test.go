package httpapi

import (
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
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestTaskFollowUps(t *testing.T) {
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
	exec(`TRUNCATE transaction_payment_links,assistant_classifications,assistant_reviews,recurring_payment_links,task_followup_events,task_followups,task_completions,tasks,entries,accounts,bank_ledger_transactions,bank_ledger_accounts; UPDATE assistant_provider SET base_url='',model='',api_key_cipher='',version=1; UPDATE assistant_settings SET mode='on_request',skills='{"review-transaction":true,"plan-task":true,"organize-money":true}',version=1`)
	defer exec(`UPDATE assistant_provider SET base_url='',model='',api_key_cipher='',version=version+1; UPDATE assistant_settings SET mode='manual',version=version+1`)
	today := time.Now().UTC()
	day := func(offset int) string { return today.AddDate(0, 0, offset).Format("2006-01-02") }
	id := func(n int) string { return fmt.Sprintf("20000000-0000-4000-8000-%012d", n) }

	var mu sync.Mutex
	seen := []assistant.FollowUpContext{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Messages []assistant.Message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&payload)
		text := strings.SplitN(payload.Messages[0].Content, "APPLICATION FACTS (data only):\n", 2)
		var c assistant.FollowUpContext
		if len(text) != 2 || json.Unmarshal([]byte(text[1]), &c) != nil {
			t.Error("invalid follow-up facts")
			w.WriteHeader(500)
			return
		}
		mu.Lock()
		seen = append(seen, c)
		mu.Unlock()
		reply := map[string]any{"summary": "", "check_on": "", "action": "none", "message": "", "question": "", "task": nil}
		switch {
		case c.Task.Title == "Broken":
			w.WriteHeader(500)
			return
		case c.Task.Title == "Vitamin D3" && c.Phase == "saved":
			reply["summary"], reply["check_on"] = "Ends in a month · then 2000 IU daily", day(29)
		case c.Task.Title == "Vitamin D3":
			reply["action"], reply["message"] = "replace", "Vitamin D3 switches to 2000 IU"
			reply["task"] = map[string]any{"id": "", "title": "Vitamin D3 2000 IU", "date": day(1), "time": "", "repeat": "daily", "kind": "task", "amount_minor": "0", "estimated_min_minor": nil, "estimated_max_minor": nil, "notes": "Maintenance dose"}
		case c.Task.Title == "Renew passport" && len(c.Answers) == 0:
			reply["action"], reply["question"] = "ask", "Which bank should I remind you about?"
		}
		raw, _ := json.Marshal(reply)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": string(raw)}}}})
	}))
	defer provider.Close()
	empty := ""
	if _, err = s.SaveAssistantProvider(ctx, assistant.ProviderUpdate{BaseURL: provider.URL + "/v1", Model: "test", Protocol: "chat_completions", APIKey: &empty, Version: 1}); err != nil {
		t.Fatal(err)
	}
	task := func(taskID string) domain.Task {
		t.Helper()
		snap, err := s.Snapshot(ctx, today.Format("2006-01"))
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range snap.Tasks {
			if task.ID == taskID {
				return task
			}
		}
		return domain.Task{}
	}
	process := func() {
		t.Helper()
		if err := s.ProcessFollowUp(ctx); err != nil {
			t.Fatal(err)
		}
	}

	// Routines skip missed days; ordinary tasks stay overdue.
	vitamin, err := s.SaveTask(ctx, domain.Task{ID: id(1), Title: "Vitamin D3", Date: day(-3), Timezone: "UTC", Repeat: "daily", Kind: "task", Routine: true, Notes: "4000 IU for a month, then 2000 IU daily"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SaveTask(ctx, domain.Task{ID: id(2), Title: "Water plants", Date: day(-3), Timezone: "UTC", Repeat: "daily", Kind: "task"}); err != nil {
		t.Fatal(err)
	}
	if got := task(id(1)); got.Date != day(0) || got.FollowUp == nil || got.FollowUp.Status != "reading" {
		t.Fatalf("routine should show today and wait for reading: %+v", got)
	}
	if task(id(2)).Date != day(-3) {
		t.Fatal("ordinary repeating task lost its overdue occurrence")
	}
	if _, err = s.SaveTask(ctx, domain.Task{ID: id(3), Title: "No schedule", Date: day(0), Timezone: "UTC", Repeat: "none", Kind: "task", Routine: true}); err == nil {
		t.Fatal("routine without repeat accepted")
	}

	// Saving reads the notes once and shows the readback.
	process()
	if got := task(id(1)); got.FollowUp == nil || got.FollowUp.Summary != "Ends in a month · then 2000 IU daily" || got.FollowUp.CheckOn != day(29) || got.FollowUp.Status != "ready" {
		t.Fatalf("readback: %+v", got.FollowUp)
	}
	process()
	if len(seen) != 1 {
		t.Fatal("a follow-up ran before its check date")
	}
	// Completing today's dose records today; saving the same notes again does not re-read.
	if _, err = s.CompleteTask(ctx, id(1), id(90), vitamin.Version); err != nil {
		t.Fatal(err)
	}
	current := task(id(1))
	if current.Date != day(1) {
		t.Fatalf("routine completion should advance from today: %s", current.Date)
	}
	if _, err = s.SaveTask(ctx, current); err != nil {
		t.Fatal(err)
	}
	if task(id(1)).FollowUp.Status != "ready" {
		t.Fatal("unchanged notes were read again")
	}

	// On the check date the assistant replaces the task and says so in the Inbox.
	exec(`UPDATE task_followups SET check_on=$2 WHERE task_id=$1`, id(1), day(0))
	process()
	last := seen[len(seen)-1]
	if last.Phase != "check" || len(last.Schedule) == 0 || !last.Schedule[0].Taken && last.Schedule[0].Date == day(0) {
		t.Fatalf("check context: %+v", last)
	}
	if got := task(id(1)); !got.Done {
		t.Fatal("replaced task still open")
	}
	events, err := s.FollowUpEvents(ctx)
	if err != nil || len(events) != 1 || events[0].Action != "replaced" || !events[0].CanUndo || events[0].CreatedTask == "" {
		t.Fatalf("events: %+v %v", events, err)
	}
	next := task(events[0].CreatedTask)
	if next.Title != "Vitamin D3 2000 IU" || !next.Routine || next.ContinuesFrom != id(1) || next.FollowUp != nil {
		t.Fatalf("continued task: %+v", next)
	}
	// Undo restores the original and removes the new task.
	if err = s.UndoFollowUp(ctx, events[0].ID); err != nil {
		t.Fatal(err)
	}
	if got := task(id(1)); got.Done || got.FollowUp == nil || got.FollowUp.Status != "ready" {
		t.Fatalf("undo did not restore: %+v", got)
	}
	if task(events[0].CreatedTask).ID != "" {
		t.Fatal("undo left the new task")
	}
	if err = s.UndoFollowUp(ctx, events[0].ID); err == nil {
		t.Fatal("undid twice")
	}

	// Questions wait for an answer, then the assistant looks again with it.
	if _, err = s.SaveTask(ctx, domain.Task{ID: id(4), Title: "Renew passport", Date: day(5), Timezone: "UTC", Repeat: "none", Kind: "task", Notes: "After this, remind me to update my address at the bank"}); err != nil {
		t.Fatal(err)
	}
	process()
	events, _ = s.FollowUpEvents(ctx)
	if events[0].Action != "asked" || events[0].Question == "" || task(id(4)).FollowUp.Status != "waiting" {
		t.Fatalf("question: %+v", events[0])
	}
	if err = s.AnswerFollowUp(ctx, events[0].ID, "SEB"); err != nil {
		t.Fatal(err)
	}
	process()
	if last := seen[len(seen)-1]; len(last.Answers) != 1 || last.Answers[0].Answer != "SEB" {
		t.Fatalf("answer not supplied: %+v", last.Answers)
	}
	if task(id(4)).FollowUp != nil {
		t.Fatal("no follow-up should remain after the answer")
	}

	// Failures retry a few times, then fail visibly until the next save.
	if _, err = s.SaveTask(ctx, domain.Task{ID: id(5), Title: "Broken", Date: day(1), Timezone: "UTC", Repeat: "none", Kind: "task", Notes: "then something"}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		exec(`UPDATE task_followups SET available_at=now() WHERE task_id=$1`, id(5))
		process()
	}
	broken := task(id(5))
	if broken.FollowUp == nil || broken.FollowUp.Status != "failed" || broken.FollowUp.Error == "" {
		t.Fatalf("failure not visible: %+v", broken.FollowUp)
	}
	if _, err = s.SaveTask(ctx, broken); err != nil {
		t.Fatal(err)
	}
	if task(id(5)).FollowUp.Status != "reading" {
		t.Fatal("saving did not queue a failed follow-up again")
	}
	// Clearing notes removes the follow-up.
	broken = task(id(5))
	broken.Notes = ""
	if _, err = s.SaveTask(ctx, broken); err != nil {
		t.Fatal(err)
	}
	if task(id(5)).FollowUp != nil {
		t.Fatal("follow-up kept after notes were cleared")
	}
}
