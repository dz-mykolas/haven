package store

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

// FollowUpEvent is one thing the follow-up assistant did or asked, for the Inbox.
type FollowUpEvent struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id" db:"task_id"`
	Title       string    `json:"title"`
	Action      string    `json:"action"`
	Message     string    `json:"message"`
	Question    string    `json:"question"`
	Answer      string    `json:"answer"`
	CreatedTask string    `json:"created_task,omitempty" db:"created_task"`
	Status      string    `json:"status"`
	CanUndo     bool      `json:"can_undo" db:"can_undo"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}
type followUpRow struct {
	TaskID   string `db:"task_id"`
	Notes    string
	Summary  string
	CheckOn  string `db:"check_on"`
	Status   string
	Error    string
	Attempts int
}
type followUpBefore struct {
	Task    domain.Task `json:"task"`
	Summary string      `json:"summary"`
	CheckOn string      `json:"check_on"`
	Notes   string      `json:"notes"`
	Status  string      `json:"status"`
}

const followUpCols = `task_id::text,notes,summary,COALESCE(check_on::text,'') AS check_on,status,error,attempts`

// currentTasks applies routine catch-up and attaches follow-up state.
func currentTasks(ctx context.Context, tx pgx.Tx, tasks []domain.Task) ([]domain.Task, error) {
	rows, err := list[followUpRow](ctx, tx, `SELECT `+followUpCols+` FROM task_followups WHERE status<>'done'`)
	if err != nil {
		return nil, err
	}
	byID := map[string]followUpRow{}
	for _, r := range rows {
		byID[r.TaskID] = r
	}
	now := time.Now()
	for i := range tasks {
		tasks[i] = domain.CatchUp(tasks[i], now)
		if r, ok := byID[tasks[i].ID]; ok && (r.Summary != "" || r.Status != "ready") {
			tasks[i].FollowUp = &domain.FollowUp{Summary: r.Summary, CheckOn: r.CheckOn, Status: r.Status, Error: r.Error}
		}
	}
	sort.SliceStable(tasks, func(i, j int) bool {
		a, b := tasks[i], tasks[j]
		if a.Done != b.Done {
			return !a.Done
		}
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Time != b.Time {
			return a.Time < b.Time
		}
		return a.ID < b.ID
	})
	return tasks, nil
}

// queueFollowUp asks the assistant to read notes that changed. A failed
// reading is retried on the next save.
func queueFollowUp(ctx context.Context, tx pgx.Tx, t domain.Task) error {
	if t.Deleted || t.Done {
		_, err := tx.Exec(ctx, `UPDATE task_followups SET status='done',updated_at=now() WHERE task_id=$1`, t.ID)
		return err
	}
	notes := strings.TrimSpace(t.Notes)
	if notes == "" {
		_, err := tx.Exec(ctx, `DELETE FROM task_followups WHERE task_id=$1`, t.ID)
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO task_followups(task_id,notes,status) VALUES($1,$2,'reading')
        ON CONFLICT(task_id) DO UPDATE SET notes=$2,status='reading',summary='',check_on=NULL,error='',attempts=0,available_at=now(),updated_at=now()
        WHERE task_followups.notes<>$2 OR task_followups.status IN ('failed','done')`, t.ID, notes)
	return err
}

// RunFollowUps lives with the API. One task is handled per tick; an advisory
// lock prevents overlapping workers across processes.
func (s *Store) RunFollowUps(ctx context.Context) {
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := s.ProcessFollowUp(ctx); err != nil && ctx.Err() == nil {
				slog.Error("task follow-up worker failed", "error", err)
			}
			timer.Reset(2 * time.Second)
		}
	}
}

// ProcessFollowUp handles at most one due follow-up.
func (s *Store) ProcessFollowUp(ctx context.Context) error {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var acquired bool
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(728199)`).Scan(&acquired); err != nil || !acquired {
		return err
	}
	defer func() {
		unlock, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlock, `SELECT pg_advisory_unlock(728199)`); err != nil {
			_ = conn.Conn().Close(unlock)
		}
	}()
	// Cheap check first: check dates are compared in each task's timezone
	// below, so anything due by tomorrow in UTC is a candidate.
	rows, err := conn.Query(ctx, `SELECT f.task_id::text FROM task_followups f JOIN tasks t ON t.id=f.task_id
        WHERE f.available_at<=now() AND (f.status IN ('reading','checking') OR (f.status='ready' AND f.check_on<=current_date+1))
        ORDER BY f.available_at LIMIT 20`)
	if err != nil {
		return err
	}
	candidates, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(candidates) == 0 {
		return err
	}
	settings, err := s.AssistantSettings(ctx)
	if err != nil {
		return err
	}
	if settings.Authorize("follow-up", "task_followup") != nil {
		return nil
	}
	config, key, err := s.ProviderCredentials(ctx)
	if err != nil {
		return err
	}
	if config.BaseURL == "" || config.Model == "" {
		return nil
	}
	for _, id := range candidates {
		c, row, ok, err := s.followUpContext(ctx, id)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		callCtx, cancel := context.WithTimeout(ctx, 80*time.Second)
		raw, callErr := assistant.Complete(callCtx, config, key, assistant.FollowUpPrompt(c), []assistant.Message{{Role: "user", Content: "Handle this task's follow-up."}})
		cancel()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var decision assistant.FollowUpDecision
		if callErr == nil {
			decision, callErr = assistant.ParseFollowUp(raw, c)
		}
		return s.applyFollowUp(ctx, c, row, decision, callErr)
	}
	return nil
}

// followUpContext gathers what the model sees for one task, or ok=false when
// the task is not due in its own timezone.
func (s *Store) followUpContext(ctx context.Context, id string) (assistant.FollowUpContext, followUpRow, bool, error) {
	var c assistant.FollowUpContext
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return c, followUpRow{}, false, err
	}
	defer tx.Rollback(ctx)
	row, err := one[followUpRow](ctx, tx, `SELECT `+followUpCols+` FROM task_followups WHERE task_id=$1`, id)
	if err != nil {
		return c, row, false, err
	}
	task, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1`, id)
	if err != nil {
		return c, row, false, err
	}
	location, err := time.LoadLocation(task.Timezone)
	if err != nil {
		location = time.UTC
	}
	now := time.Now().In(location)
	c.Today = now.Format("2006-01-02")
	if row.Status == "ready" && row.CheckOn > c.Today {
		return c, row, false, nil
	}
	c.Phase = "check"
	if row.Status == "reading" {
		c.Phase = "saved"
	}
	task = domain.CatchUp(task, now)
	task.FollowUp = nil
	c.Task, c.Summary, c.CheckOn = task, row.Summary, row.CheckOn
	var started time.Time
	if err = tx.QueryRow(ctx, `SELECT created_at FROM tasks WHERE id=$1`, id).Scan(&started); err != nil {
		return c, row, false, err
	}
	c.Started = started.In(location).Format("2006-01-02")
	completions, err := list[domain.Completion](ctx, tx, `SELECT id::text,task_id::text,due_date::text,completed_at FROM task_completions WHERE task_id=$1 ORDER BY due_date DESC LIMIT 120`, id)
	if err != nil {
		return c, row, false, err
	}
	taken := map[string]bool{}
	for _, done := range completions {
		taken[done.DueDate] = true
	}
	if task.Routine {
		// Scheduled days up to today, newest first, from when the task began.
		for _, date := range pastOccurrences(task, c.Started, c.Today, 60) {
			c.Schedule = append(c.Schedule, assistant.Occurrence{Date: date, Taken: taken[date]})
		}
	} else {
		for i, done := range completions {
			if i < 30 {
				c.Completed = append(c.Completed, done.DueDate)
			}
		}
	}
	for previous, hops := task.ContinuesFrom, 0; previous != "" && hops < 5; hops++ {
		p, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1`, previous)
		if err != nil {
			break
		}
		c.Previous = append(c.Previous, assistant.PreviousTask{Title: p.Title, Notes: p.Notes})
		previous = p.ContinuesFrom
	}
	answers, err := list[assistant.Answer](ctx, tx, `SELECT question,answer FROM task_followup_events WHERE task_id=$1 AND action='asked' AND status='answered' ORDER BY created_at DESC LIMIT 5`, id)
	if err != nil {
		return c, row, false, err
	}
	c.Answers = answers
	return c, row, true, tx.Commit(ctx)
}

// pastOccurrences steps a schedule backwards from the task's next date.
func pastOccurrences(t domain.Task, from, through string, limit int) []string {
	out := []string{}
	d, err := time.Parse("2006-01-02", t.Date)
	if err != nil {
		return out
	}
	anchor := t.AnchorDay
	if anchor == 0 {
		anchor = d.Day()
	}
	for i := 0; len(out) < limit && i < 400; i++ {
		switch t.Repeat {
		case "daily":
			d = d.AddDate(0, 0, -1)
		case "weekly":
			d = d.AddDate(0, 0, -7)
		case "monthly", "yearly":
			months := -1
			if t.Repeat == "yearly" {
				months = -12
			}
			first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
			d = first.AddDate(0, 0, min(anchor, first.AddDate(0, 1, -1).Day())-1)
		default:
			return out
		}
		date := d.Format("2006-01-02")
		if date < from {
			break
		}
		if date <= through {
			out = append(out, date)
		}
	}
	return out
}

// applyFollowUp writes the decision unless the user changed the task or its
// notes meanwhile, in which case their newer save wins.
func (s *Store) applyFollowUp(ctx context.Context, c assistant.FollowUpContext, row followUpRow, d assistant.FollowUpDecision, callErr error) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, c.Task.ID); err != nil {
		return err
	}
	current, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1 FOR UPDATE`, c.Task.ID)
	if err != nil {
		return err
	}
	latest, err := one[followUpRow](ctx, tx, `SELECT `+followUpCols+` FROM task_followups WHERE task_id=$1 FOR UPDATE`, c.Task.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if current.Version != c.Task.Version || latest.Notes != row.Notes || latest.Status != row.Status {
		return tx.Commit(ctx)
	}
	if callErr != nil {
		// A few retries spread out, then fail visibly until the next save.
		_, err = tx.Exec(ctx, `UPDATE task_followups SET attempts=attempts+1,
            status=CASE WHEN attempts>=2 THEN 'failed' ELSE (CASE WHEN status='ready' THEN 'checking' ELSE status END) END,
            error=CASE WHEN attempts>=2 THEN $2 ELSE '' END,
            available_at=now()+CASE attempts WHEN 0 THEN interval '1 minute' ELSE interval '10 minutes' END,
            updated_at=now() WHERE task_id=$1`, c.Task.ID, callErr.Error())
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	before, _ := json.Marshal(followUpBefore{Task: current, Summary: row.Summary, CheckOn: row.CheckOn, Notes: row.Notes, Status: row.Status})
	status := "ready"
	if d.Summary == "" {
		status = "done"
	}
	setFollowUp := func(taskID, notes, summary, checkOn, status string) error {
		_, err := tx.Exec(ctx, `INSERT INTO task_followups(task_id,notes,summary,check_on,status) VALUES($1,$2,$3,NULLIF($4,'')::date,$5)
            ON CONFLICT(task_id) DO UPDATE SET notes=$2,summary=$3,check_on=NULLIF($4,'')::date,status=$5,error='',attempts=0,available_at=now(),updated_at=now()`, taskID, strings.TrimSpace(notes), summary, checkOn, status)
		return err
	}
	event := func(action, message, question, created string) error {
		_, err := tx.Exec(ctx, `INSERT INTO task_followup_events(task_id,action,message,question,before,created_task) VALUES($1,$2,$3,$4,$5,NULLIF($6,'')::uuid)`, c.Task.ID, action, message, question, before, created)
		return err
	}
	switch d.Action {
	case "none":
		err = setFollowUp(current.ID, current.Notes, d.Summary, d.CheckOn, status)
	case "ask":
		if err = setFollowUp(current.ID, current.Notes, row.Summary, row.CheckOn, "waiting"); err == nil {
			err = event("asked", "", d.Question, "")
		}
	case "update":
		next := *d.Task
		next.Done, next.Deleted, next.Version = current.Done, current.Deleted, current.Version+1
		next.ContinuesFrom, next.Routine = current.ContinuesFrom, current.Routine
		if err = putTask(ctx, tx, next); err == nil {
			if err = setFollowUp(current.ID, next.Notes, d.Summary, d.CheckOn, status); err == nil {
				err = event("updated", d.Message, "", "")
			}
		}
	case "replace":
		next := *d.Task
		next.Version = 1
		closed := current
		closed.Done, closed.Version = true, current.Version+1
		if err = putTask(ctx, tx, closed); err == nil {
			if err = putTask(ctx, tx, next); err == nil {
				if err = setFollowUp(current.ID, current.Notes, row.Summary, "", "done"); err == nil {
					if strings.TrimSpace(next.Notes) != "" {
						err = setFollowUp(next.ID, next.Notes, d.Summary, d.CheckOn, status)
					}
					if err == nil {
						err = event("replaced", d.Message, "", next.ID)
					}
				}
			}
		}
	case "finish":
		closed := current
		closed.Done, closed.Version = true, current.Version+1
		if err = putTask(ctx, tx, closed); err == nil {
			if err = setFollowUp(current.ID, current.Notes, row.Summary, "", "done"); err == nil {
				err = event("finished", d.Message, "", "")
			}
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// FollowUpEvents lists recent follow-up activity, newest first.
func (s *Store) FollowUpEvents(ctx context.Context) ([]FollowUpEvent, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	events, err := list[FollowUpEvent](ctx, tx, `SELECT e.id::text,e.task_id::text,t.title,e.action,e.message,e.question,e.answer,COALESCE(e.created_task::text,'') AS created_task,e.status,
        (e.action<>'asked' AND e.status IN ('new','seen') AND e.created_at=(SELECT max(created_at) FROM task_followup_events x WHERE x.task_id=e.task_id)) AS can_undo,e.created_at
        FROM task_followup_events e JOIN tasks t ON t.id=e.task_id WHERE NOT t.deleted ORDER BY e.created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	return events, tx.Commit(ctx)
}

func (s *Store) followUpEvent(ctx context.Context, tx pgx.Tx, id string) (FollowUpEvent, json.RawMessage, error) {
	var before json.RawMessage
	if !domain.ValidID(id) {
		return FollowUpEvent{}, nil, &Error{404, "Inbox item not found"}
	}
	rows, err := tx.Query(ctx, `SELECT id::text,task_id::text,action,question,COALESCE(created_task::text,''),status,before FROM task_followup_events WHERE id=$1 FOR UPDATE`, id)
	if err != nil {
		return FollowUpEvent{}, nil, err
	}
	defer rows.Close()
	var e FollowUpEvent
	if !rows.Next() {
		return e, nil, &Error{404, "Inbox item not found"}
	}
	if err = rows.Scan(&e.ID, &e.TaskID, &e.Action, &e.Question, &e.CreatedTask, &e.Status, &before); err != nil {
		return e, nil, err
	}
	rows.Close()
	return e, before, nil
}

// SeeFollowUp acknowledges a notice so it leaves "To review".
func (s *Store) SeeFollowUp(ctx context.Context, id string) error {
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		e, _, err := s.followUpEvent(ctx, tx, id)
		if err != nil {
			return err
		}
		if e.Status == "new" && e.Action != "asked" {
			_, err = tx.Exec(ctx, `UPDATE task_followup_events SET status='seen' WHERE id=$1`, id)
		}
		return err
	})
}

// AnswerFollowUp records the user's reply and has the assistant look again.
func (s *Store) AnswerFollowUp(ctx context.Context, id, answer string) error {
	answer = strings.TrimSpace(answer)
	if answer == "" || len([]rune(answer)) > 1000 {
		return bad("Write an answer of up to 1000 characters")
	}
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		e, _, err := s.followUpEvent(ctx, tx, id)
		if err != nil {
			return err
		}
		if e.Action != "asked" || e.Status != "new" {
			return bad("This question was already answered")
		}
		if _, err = tx.Exec(ctx, `UPDATE task_followup_events SET status='answered',answer=$2 WHERE id=$1`, id, answer); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE task_followups SET status='checking',attempts=0,error='',available_at=now(),updated_at=now() WHERE task_id=$1 AND status='waiting'`, e.TaskID)
		return err
	})
}

// UndoFollowUp restores the task as it was before the assistant's change.
// Only the latest change to a task can be undone.
func (s *Store) UndoFollowUp(ctx context.Context, id string) error {
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		e, raw, err := s.followUpEvent(ctx, tx, id)
		if err != nil {
			return err
		}
		var newer bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM task_followup_events WHERE task_id=$1 AND created_at>(SELECT created_at FROM task_followup_events WHERE id=$2))`, e.TaskID, id).Scan(&newer); err != nil {
			return err
		}
		if e.Action == "asked" || (e.Status != "new" && e.Status != "seen") || newer {
			return bad("This change can no longer be undone")
		}
		var before followUpBefore
		if err = json.Unmarshal(raw, &before); err != nil {
			return err
		}
		for _, task := range []string{e.TaskID, e.CreatedTask} {
			if task == "" {
				continue
			}
			if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, task); err != nil {
				return err
			}
		}
		current, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1 FOR UPDATE`, e.TaskID)
		if err != nil {
			return err
		}
		restored := before.Task
		restored.Version = current.Version + 1
		if err = putTask(ctx, tx, restored); err != nil {
			return err
		}
		if e.CreatedTask != "" {
			created, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1 FOR UPDATE`, e.CreatedTask)
			if err != nil {
				return err
			}
			created.Deleted, created.Version = true, created.Version+1
			if err = putTask(ctx, tx, created); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `UPDATE task_followups SET status='done',updated_at=now() WHERE task_id=$1`, e.CreatedTask); err != nil {
				return err
			}
		}
		// Look again later rather than immediately redoing the same change.
		if _, err = tx.Exec(ctx, `UPDATE task_followups SET notes=$2,summary=$3,check_on=NULLIF($4,'')::date,status='ready',error='',attempts=0,available_at=now()+interval '1 day',updated_at=now() WHERE task_id=$1`, e.TaskID, strings.TrimSpace(before.Notes), before.Summary, before.CheckOn); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE task_followup_events SET status='undone' WHERE id=$1`, id)
		return err
	})
}
