package store

import (
	"context"
	"encoding/json"
	"log/slog"
	"reflect"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

type ReviewItem struct {
	Question  string        `json:"question"`
	CanUndo   bool          `json:"can_undo" db:"-"`
	Reason    string        `json:"reason"`
	EntryID   string        `json:"entry_id" db:"entry_id"`
	Original  domain.Entry  `json:"original"`
	Draft     *domain.Entry `json:"draft"`
	Status    string        `json:"status"`
	CreatedAt time.Time     `json:"created_at" db:"created_at"`
}
type ReviewInbox struct {
	NextCursor   string       `json:"next_cursor"`
	Items        []ReviewItem `json:"items"`
	ReviewCount  int          `json:"review_count"`
	PendingCount int          `json:"pending_count"`
	FailedCount  int          `json:"failed_count"`
	Total        int          `json:"total"`
	Enabled      bool         `json:"enabled"`
}

func reviewEligible(e domain.Entry) bool {
	// A user revision is an explicit choice, even if they left the category empty.
	return !e.Deleted && e.Kind != "transfer" && ((e.CategoryID == "" && e.Version == 1) ||
		(e.Kind == "expense" && strings.EqualFold(e.Category, "Recurring") && e.Payment == nil))
}
func completeReview(ctx context.Context, tx pgx.Tx, id string) error {
	if err := lockAutomaticClassification(ctx, tx, id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE assistant_reviews SET status='completed', updated_at=now() WHERE entry_id=$1 AND status IN ('queued','processing','review','failed')`, id)
	return err
}
func sameReviewEntry(a, b domain.Entry) bool {
	// Category names can be renamed independently without changing the record.
	a.Category, b.Category = "", ""
	// Linked tasks have their own optimistic versions and can advance separately.
	a.Payment, b.Payment = nil, nil
	a.PaymentUnits, b.PaymentUnits = 0, 0
	if len(a.Tags) == 0 {
		a.Tags = nil
	}
	if len(b.Tags) == 0 {
		b.Tags = nil
	}
	return reflect.DeepEqual(a, b)
}

// Caller holds the classification and bank-import locks. This makes the captured
// facts consistent with edits and imports, without holding locks during model IO.
func reviewSnapshot(ctx context.Context, tx pgx.Tx) (domain.Snapshot, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728194)`); err != nil {
		return domain.Snapshot{}, err
	}
	if err := classificationLock(ctx, tx); err != nil {
		return domain.Snapshot{}, err
	}
	return snapshot(ctx, tx, time.Now().UTC().Format("2006-01"))
}
func reconcileReviews(ctx context.Context, tx pgx.Tx, entries []domain.Entry, enqueue bool) error {
	current := map[string]domain.Entry{}
	for _, e := range entries {
		current[e.ID] = e
	}
	rows, err := list[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE status IN ('queued','processing','review','failed')`)
	if err != nil {
		return err
	}
	for _, r := range rows {
		e, ok := current[r.EntryID]
		if !ok || !sameReviewEntry(e, r.Original) {
			if _, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='stale',updated_at=now() WHERE entry_id=$1 AND status IN ('queued','processing','review','failed')`, r.EntryID); err != nil {
				return err
			}
		}
	}
	if enqueue {
		eligible := []domain.Entry{}
		for _, e := range entries {
			if reviewEligible(e) {
				eligible = append(eligible, e)
			}
		}
		if len(eligible) > 0 {
			raw, err := json.Marshal(eligible)
			if err != nil {
				return err
			}
			// One insert also gives every initial-history item the same arrival
			// time; subsequent arrivals sort ahead of that initial batch.
			_, err = tx.Exec(ctx, `INSERT INTO assistant_reviews(entry_id,original)
                SELECT (item->>'id')::uuid,item FROM jsonb_array_elements($1::jsonb) AS item
                ON CONFLICT DO NOTHING`, raw)
			if err != nil {
				return err
			}
		}
	}
	return consolidateScheduleReviews(ctx, tx, entries)
}
func (s *Store) ReviewInbox(ctx context.Context, history bool, cursor string) (ReviewInbox, error) {
	out := ReviewInbox{Items: []ReviewItem{}}
	scope := cursorScope(history)
	after, err := decodeCursor(cursor, scope)
	if err != nil {
		return out, err
	}
	if cursor != "" && after.Created.IsZero() {
		return out, bad("Invalid inbox cursor")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	snap, err := reviewSnapshot(ctx, tx)
	if err != nil {
		return out, err
	}
	if err = reconcileReviews(ctx, tx, snap.Entries, false); err != nil {
		return out, err
	}
	settings, err := assistantSettings(ctx, tx, false)
	if err != nil {
		return out, err
	}
	var connected bool
	if err = tx.QueryRow(ctx, `SELECT base_url<>'' AND model<>'' FROM assistant_provider WHERE singleton`).Scan(&connected); err != nil {
		return out, err
	}
	out.Enabled = connected && settings.Authorize("review-transaction", "transaction_imported") == nil
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE status='review'),count(*) FILTER(WHERE status IN ('queued','processing')),count(*) FILTER(WHERE status='failed') FROM assistant_reviews`).Scan(&out.ReviewCount, &out.PendingCount, &out.FailedCount); err != nil {
		return out, err
	}
	filter := `status='review'`
	if history {
		filter = `status IN ('dismissed','completed','unchanged','stale','auto_applied','undone')`
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM assistant_reviews WHERE `+filter).Scan(&out.Total); err != nil {
		return out, err
	}
	out.Items, err = list[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE `+filter+`
        AND ($1='' OR original->>'date' < $1 OR (original->>'date'=$1 AND (created_at<$2 OR (created_at=$2 AND entry_id::text>$3))))
        ORDER BY original->>'date' DESC,created_at DESC,entry_id LIMIT 51`, after.Date, after.Created, after.ID)
	if err != nil {
		return out, err
	}
	if len(out.Items) > FeedPageSize {
		out.Items = out.Items[:FeedPageSize]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(feedCursor{Scope: scope, Date: last.Original.Date, ID: last.EntryID, Created: last.CreatedAt})
	}
	owned, err := automaticClassifications(ctx, tx)
	if err != nil {
		return out, err
	}
	for i := range out.Items {
		for _, e := range snap.Entries {
			if e.ID == out.Items[i].EntryID {
				out.Items[i].CanUndo = owned[e.ID].owns(e)
				break
			}
		}
	}
	// Use today's catalog labels on drafts, rather than stale model-time names.
	for i := range out.Items {
		if d := out.Items[i].Draft; d != nil {
			for _, e := range snap.Entries {
				if e.ID == d.ID && e.Payment != nil {
					d.Payment = e.Payment
				}
			}
			for _, c := range snap.Categories {
				if c.ID == d.CategoryID {
					d.Category = c.Name
				}
			}
		}
	}
	return out, tx.Commit(ctx)
}
func (s *Store) DismissReview(ctx context.Context, id string) error {
	if !domain.ValidID(id) {
		return bad("Invalid transaction ID")
	}
	result, err := s.Pool.Exec(ctx, `UPDATE assistant_reviews SET status='dismissed',updated_at=now() WHERE entry_id=$1 AND status IN ('review','failed','dismissed')`, id)
	if err == nil && result.RowsAffected() == 0 {
		return &Error{409, "This suggestion has already been handled. Refresh the inbox"}
	}
	return err
}
func (s *Store) RetryReviews(ctx context.Context) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	settings, err := assistantSettings(ctx, tx, true)
	if err != nil {
		return err
	}
	if settings.Authorize("review-transaction", "transaction_imported") != nil {
		return bad("Enable Suggest too and Review transactions first")
	}
	_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='queued',attempts=0,available_at=now(),updated_at=now() WHERE status='failed'`)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// RunReviews lives with the API, not the browser. A PostgreSQL advisory lock
// prevents overlapping workers across processes; unfinished batches are reclaimed
// on the next run after a restart. Only five transactions enter each model request.
func (s *Store) RunReviews(ctx context.Context) {
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if err := s.ProcessReviewBatch(ctx); err != nil && ctx.Err() == nil {
				slog.Error("transaction review worker failed")
			}
			timer.Reset(5 * time.Second)
		}
	}
}
func (s *Store) ProcessReviewBatch(ctx context.Context) error {
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var acquired bool
	if err = conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(728197)`).Scan(&acquired); err != nil || !acquired {
		return err
	}
	defer func() {
		unlock, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(unlock, `SELECT pg_advisory_unlock(728197)`); err != nil {
			_ = conn.Conn().Close(unlock)
		}
	}()
	settings, err := s.AssistantSettings(ctx)
	if err != nil {
		return err
	}
	if settings.Authorize("review-transaction", "transaction_imported") != nil {
		return nil
	}
	config, key, err := s.ProviderCredentials(ctx)
	if err != nil {
		return err
	}
	if config.BaseURL == "" || config.Model == "" {
		return nil
	}
	// Loading everything is only needed when data changed since the last
	// reconcile (new imports, edits) or queued work is due.
	var changes int64
	var due bool
	if err = conn.QueryRow(ctx, `SELECT last_value FROM haven_changes`).Scan(&changes); err != nil {
		return err
	}
	if err = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assistant_reviews WHERE status IN ('queued','processing') AND available_at<=now())`).Scan(&due); err != nil {
		return err
	}
	if !due && changes == s.reviewsSeen.Load() {
		return nil
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	snap, err := reviewSnapshot(ctx, tx)
	if err != nil {
		return err
	}
	if err = reconcileReviews(ctx, tx, snap.Entries, true); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='queued' WHERE status='processing'`); err != nil {
		return err
	}
	batch, err := list[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE status='queued' AND available_at<=now() ORDER BY created_at DESC,original->>'date' DESC,entry_id LIMIT 5 FOR UPDATE`)
	if err != nil {
		return err
	}
	if len(batch) == 0 {
		if err = tx.Commit(ctx); err == nil {
			s.reviewsSeen.Store(changes)
		}
		return err
	}
	entries := make([]domain.Entry, 0, len(batch))
	for _, item := range batch {
		entries = append(entries, item.Original)
		if _, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='processing',updated_at=now() WHERE entry_id=$1`, item.EntryID); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	// Scope background context and contracts to the transaction review skill only.
	scoped := settings
	scoped.Skills = map[string]bool{}
	for _, skill := range assistant.Catalog() {
		scoped.Skills[skill.ID] = skill.ID == "review-transaction"
	}
	history := assistant.ReviewHistory(entries, snap.Entries)
	for _, t := range snap.Tasks {
		if t.Kind == "payment" && !t.Done && !t.Deleted && (t.Forecast() || t.Repeat != "none") && len(history.Plans) < 100 {
			history.Plans = append(history.Plans, t)
		}
	}
	history.Answers = map[string]string{}
	for _, item := range batch {
		var answer string
		if err = s.Pool.QueryRow(ctx, `SELECT answer FROM assistant_reviews WHERE entry_id=$1`, item.EntryID).Scan(&answer); err != nil {
			return err
		}
		if answer != "" {
			history.Answers[item.EntryID] = answer
		}
	}
	prompt := assistant.ReviewPrompt(scoped, entries, snap.Categories, snap.Tags, history)
	// Recheck consent immediately before dispatch, after queue/context work.
	beforeCall, err := s.AssistantSettings(ctx)
	if err != nil {
		return err
	}
	beforeProvider, err := s.AssistantProvider(ctx)
	if err != nil {
		return err
	}
	if beforeCall.Version != settings.Version || beforeProvider.Version != config.Version || beforeCall.Authorize("review-transaction", "transaction_imported") != nil {
		_, err = s.Pool.Exec(ctx, `UPDATE assistant_reviews SET status='queued',updated_at=now() WHERE status='processing'`)
		return err
	}
	callCtx, cancel := context.WithTimeout(ctx, 80*time.Second)
	raw, callErr := assistant.Complete(callCtx, config, key, prompt, []assistant.Message{{Role: "user", Content: "Review these selected transactions for the inbox."}})
	cancel()
	var reply assistant.ChatReply
	if callErr == nil {
		reply, callErr = assistant.ParseReviewReply(raw, scoped, entries, snap.Categories, history.Plans...)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	tx, err = s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	fresh, err := reviewSnapshot(ctx, tx)
	if err != nil {
		return err
	}
	if err = reconcileReviews(ctx, tx, fresh.Entries, false); err != nil {
		return err
	}
	latest, err := assistantSettings(ctx, tx, true)
	if err != nil {
		return err
	}
	var providerVersion int64
	if err = tx.QueryRow(ctx, `SELECT version FROM assistant_provider WHERE singleton FOR UPDATE`).Scan(&providerVersion); err != nil {
		return err
	}
	policyChanged := latest.Version != settings.Version || providerVersion != config.Version || latest.Authorize("review-transaction", "transaction_imported") != nil
	owned, err := automaticClassifications(ctx, tx)
	if err != nil {
		return err
	}
	planVersions := map[string]int64{}
	for _, task := range fresh.Tasks {
		planVersions[task.ID] = task.Version
	}
	for _, item := range batch {
		// A manual edit or provider correction during model IO must prevent
		// writes, not merely prevent publishing the draft afterward.
		var current *domain.Entry
		for _, e := range fresh.Entries {
			if e.ID == item.EntryID && sameReviewEntry(e, item.Original) {
				current = &e
				break
			}
		}
		var statusNow string
		if err = tx.QueryRow(ctx, `SELECT status FROM assistant_reviews WHERE entry_id=$1`, item.EntryID).Scan(&statusNow); err != nil {
			return err
		}
		if current == nil || statusNow != "processing" {
			continue
		}
		if policyChanged {
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='queued',updated_at=now() WHERE entry_id=$1 AND status='processing'`, item.EntryID)
		} else if callErr != nil {
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET attempts=attempts+1,status=CASE WHEN attempts>=2 THEN 'failed' ELSE 'queued' END,available_at=now()+interval '1 minute',updated_at=now() WHERE entry_id=$1 AND status='processing'`, item.EntryID)
		} else {
			var draft *domain.Entry
			question := reply.Questions[item.EntryID]
			for _, e := range reply.Entries {
				if e.ID != item.EntryID {
					continue
				}
				e.Notes = item.Original.Notes
				// Accepted recurring categories stay intact during schedule backfill.
				if item.Original.CategoryID != "" && (!owned[current.ID].owns(*current) || owned[current.ID].Original.CategoryID != "") {
					e.CategoryID = item.Original.CategoryID
					e.Category = item.Original.Category
				}
				// Background suggestions can add tags, never erase saved annotations.
				if e.CategoryID == "" {
					e.CategoryID = item.Original.CategoryID
					e.Category = item.Original.Category
				}
				e.Tags = assistant.ReviewTags(item.Original.Tags, e.Tags, fresh.Tags)
				valid := e.CategoryID == "" || e.CategoryID == item.Original.CategoryID
				for _, c := range fresh.Categories {
					if c.ID == e.CategoryID && !c.Hidden {
						e.Category = c.Name
						valid = true
					}
				}
				if valid && (question != "" || !sameReviewEntry(e, item.Original) || (e.Payment != nil && item.Original.Payment == nil)) {
					draft = &e
				}
			}
			// An already approved arrangement can classify its next charge
			// without creating another schedule or another approval item.
			if category := existingPaymentCategory(*current, fresh.Categories); category != "" {
				if draft == nil {
					copy := *current
					draft = &copy
				}
				draft.CategoryID = category
			}
			status := "unchanged"
			var encoded []byte
			original := *current
			if draft != nil {
				after, saveErr := applyAutomaticClassification(ctx, tx, *current, *draft)
				if saveErr != nil {
					return saveErr
				}
				status = "auto_applied"
				// Only a new schedule requires a decision. Its editor starts
				// from the already-saved annotations and current revision.
				if question != "" {
					status = "review"
					original = after
				} else if draft.Payment != nil && current.Payment == nil && draft.Payment.Version > 0 && draft.Payment.Forecast() && draft.PaymentUnits > 0 {
					// Approved product + evidenced quantity: link once, then let
					// deterministic coverage arithmetic advance the forecast.
					var active *domain.Task
					for _, t := range fresh.Tasks {
						if t.ID == draft.Payment.ID && planVersions[t.ID] == draft.Payment.Version && !t.Done && !t.Deleted {
							active = &t
							break
						}
					}
					if active == nil {
						return &Error{409, "Payment plan changed during classification; retry"}
					}
					after.PaymentUnits = draft.PaymentUnits
					after.Payment, err = saveEntryPayment(ctx, tx, after, active)
					if err != nil {
						return err
					}
					for i := range fresh.Tasks {
						if fresh.Tasks[i].ID == after.Payment.ID {
							fresh.Tasks[i] = *after.Payment
						}
					}
				} else if draft.Payment != nil && current.Payment == nil {
					status = "review"
					original = after
					after.Payment = draft.Payment
					after.PaymentUnits = draft.PaymentUnits
				}
				encoded, err = json.Marshal(after)
				if err != nil {
					return err
				}
				for i := range fresh.Entries {
					if fresh.Entries[i].ID == after.ID {
						fresh.Entries[i].CategoryID, fresh.Entries[i].Category, fresh.Entries[i].Tags, fresh.Entries[i].Version = after.CategoryID, after.Category, after.Tags, after.Version
					}
				}
			}
			captured, err := json.Marshal(original)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status=$2,draft=$3,reason=$4,original=$5,question=$6,updated_at=now() WHERE entry_id=$1 AND status='processing'`, item.EntryID, status, encoded, reply.Reasons[item.EntryID], captured, question)
		}
		if err != nil {
			return err
		}
	}
	if err = consolidateScheduleReviews(ctx, tx, fresh.Entries); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApplyReview shares the annotation validation with the existing editors. It also
// checks the captured bank facts, which can change independently of annotation
// versions, and resolves the inbox item in the same database transaction.
func (s *Store) ApplyReview(ctx context.Context, id string, a BankAnnotations) error {
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		snap, err := reviewSnapshot(ctx, tx)
		if err != nil {
			return err
		}
		item, err := one[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE entry_id=$1 FOR UPDATE`, id)
		if err != nil {
			return &Error{409, "This suggestion is no longer available. Refresh the inbox"}
		}
		if item.Status != "review" {
			return &Error{409, "This suggestion has already been handled. Refresh the inbox"}
		}
		var current *domain.Entry
		for _, e := range snap.Entries {
			if e.ID == id {
				current = &e
				break
			}
		}
		if current == nil || !sameReviewEntry(*current, item.Original) || a.Version != current.Version {
			return &Error{409, "This transaction changed. Close the editor and refresh the inbox"}
		}
		category := ""
		if err = normalizeClassification(ctx, tx, &a.CategoryID, &category, &a.Tags, a.Notes, current.CategoryID); err != nil {
			return err
		}
		if current.Source != "" {
			_, err = tx.Exec(ctx, `UPDATE bank_ledger_transactions SET category_id=NULLIF($2,'')::uuid,tags=$3,notes=$4,annotation_version=annotation_version+1 WHERE id=$1`, id, a.CategoryID, a.Tags, a.Notes)
		} else {
			_, err = tx.Exec(ctx, `UPDATE entries SET category_id=NULLIF($2,'')::uuid,category=$3,tags=$4,notes=$5,version=version+1 WHERE id=$1`, id, a.CategoryID, category, a.Tags, a.Notes)
		}
		if err != nil {
			return err
		}
		current.PaymentUnits = a.PaymentUnits
		if _, err = saveEntryPayment(ctx, tx, *current, a.Payment); err != nil {
			return err
		}
		return completeReview(ctx, tx, id)
	})
}
