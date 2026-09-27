package store

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

type automaticClassification struct {
	EntryID  string `db:"entry_id"`
	Original domain.Entry
	Applied  domain.Entry
	Undone   bool
	Locked   bool
}

func automaticClassifications(ctx context.Context, tx pgx.Tx) (map[string]automaticClassification, error) {
	rows, err := list[automaticClassification](ctx, tx, `SELECT entry_id::text,original,applied,undone,locked FROM assistant_classifications`)
	out := map[string]automaticClassification{}
	for _, row := range rows {
		out[row.EntryID] = row
	}
	return out, err
}

func (a automaticClassification) owns(e domain.Entry) bool {
	return a.EntryID != "" && !a.Undone && !a.Locked && sameReviewEntry(a.Applied, e)
}

// Only classification fields can be written by the background worker. The
// caller holds the classification lock and has checked the model-time facts.
func applyAutomaticClassification(ctx context.Context, tx pgx.Tx, before, proposed domain.Entry) (domain.Entry, error) {
	after := before
	after.CategoryID, after.Tags = proposed.CategoryID, proposed.Tags
	if err := normalizeClassification(ctx, tx, &after.CategoryID, &after.Category, &after.Tags, after.Notes, before.CategoryID); err != nil {
		return before, err
	}
	if sameReviewEntry(before, after) {
		return before, nil
	}
	after.Version++
	var err error
	if before.Source != "" {
		_, err = tx.Exec(ctx, `UPDATE bank_ledger_transactions SET category_id=NULLIF($2,'')::uuid,tags=$3,annotation_version=$4 WHERE id=$1`, before.ID, after.CategoryID, after.Tags, after.Version)
	} else {
		_, err = tx.Exec(ctx, `UPDATE entries SET category_id=NULLIF($2,'')::uuid,category=$3,tags=$4,version=$5 WHERE id=$1`, before.ID, after.CategoryID, after.Category, after.Tags, after.Version)
	}
	if err != nil {
		return before, err
	}
	original, err := json.Marshal(before)
	if err != nil {
		return before, err
	}
	applied, err := json.Marshal(after)
	if err != nil {
		return before, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO assistant_classifications(entry_id,original,applied) VALUES($1,$2,$3)
 ON CONFLICT(entry_id) DO UPDATE SET applied=$3`, before.ID, original, applied)
	return after, err
}

// User edits are authoritative, including saving an unchanged AI suggestion.
func lockAutomaticClassification(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `UPDATE assistant_classifications SET locked=true WHERE entry_id=$1`, id)
	return err
}

// An approved arrangement groups past and future charges through the existing
// account/payee association. Only earlier AI-owned categories are promoted.
func classifyArrangementHistory(ctx context.Context, tx pgx.Tx, selected domain.Entry) error {
	owned, err := automaticClassifications(ctx, tx)
	if err != nil {
		return err
	}
	var category string
	if err = tx.QueryRow(ctx, `SELECT id::text FROM money_categories WHERE lower(name)='recurring' AND NOT hidden`).Scan(&category); err == pgx.ErrNoRows {
		return nil
	} else if err != nil {
		return err
	}
	_, bankEntries, err := appendBankLedger(ctx, tx, nil, nil)
	if err != nil {
		return err
	}
	banks := map[string]domain.Entry{}
	for _, e := range bankEntries {
		banks[e.ID] = e
	}
	for _, a := range owned {
		if a.EntryID == selected.ID || a.Undone || a.Locked || a.Original.CategoryID != "" {
			continue
		}
		e := a.Applied
		if e.AccountID != selected.AccountID || paymentKey(e) != paymentKey(selected) || e.Kind != "expense" || e.CategoryID == category {
			continue
		}
		// Versions protect manual edits; bank facts are verified by the snapshot
		// used below so changed provider records cannot be silently rewritten.
		var current domain.Entry
		if e.Source == "" {
			current, err = one[domain.Entry](ctx, tx, `SELECT `+entryCols+` FROM entries WHERE id=$1 AND NOT deleted`, e.ID)
		} else {
			current, err = banks[e.ID], nil
		}
		if err == pgx.ErrNoRows {
			continue
		}
		if err != nil {
			return err
		}
		if !a.owns(current) {
			continue
		}
		proposed := current
		proposed.CategoryID = category
		after, err := applyAutomaticClassification(ctx, tx, current, proposed)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(after)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET draft=$2,status='auto_applied',reason='Linked to an approved recurring payment.',updated_at=now() WHERE entry_id=$1 AND status NOT IN ('dismissed','undone')`, e.ID, raw)
		if err != nil {
			return err
		}
	}
	return nil
}

func sameArrangement(a, b domain.Entry) bool {
	return a.Kind == "expense" && b.Kind == "expense" && a.AccountID == b.AccountID && paymentKey(a) == paymentKey(b)
}

// A schedule is one decision, even when a backfill contains many charges.
func consolidateScheduleReviews(ctx context.Context, tx pgx.Tx, entries []domain.Entry) error {
	rows, err := list[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE status='review' ORDER BY original->>'date' DESC,created_at DESC,entry_id`)
	if err != nil {
		return err
	}
	seen := []ReviewItem{}
	for _, r := range rows {
		if r.Question!="" || r.Draft == nil || r.Draft.Payment == nil {
			continue
		}
		resolved := false
		for _, e := range entries {
			if sameArrangement(e, r.Original) && e.Payment != nil && strings.EqualFold(e.Payment.Title, r.Draft.Payment.Title) {
				resolved = true
				break
			}
		}
		for _, e := range seen {
			if sameArrangement(e.Original, r.Original) && e.Draft != nil && e.Draft.Payment != nil && strings.EqualFold(e.Draft.Payment.Title, r.Draft.Payment.Title) {
				resolved = true
				break
			}
		}
		if resolved {
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status=CASE WHEN EXISTS(SELECT 1 FROM assistant_classifications a WHERE a.entry_id=assistant_reviews.entry_id AND NOT a.undone) THEN 'auto_applied' ELSE 'unchanged' END,updated_at=now() WHERE entry_id=$1 AND status='review'`, r.EntryID)
			if err != nil {
				return err
			}
		} else {
			seen = append(seen, r)
		}
	}
	return nil
}

func (s *Store) UndoClassification(ctx context.Context, id string) error {
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		snap, err := reviewSnapshot(ctx, tx)
		if err != nil {
			return err
		}
		owned, err := automaticClassifications(ctx, tx)
		if err != nil {
			return err
		}
		a := owned[id]
		for _, e := range snap.Entries {
			if e.ID != id || !a.owns(e) {
				continue
			}
			// Revert only category/tags; neither bank facts nor schedules change.
			original := e
			original.CategoryID, original.Tags = a.Original.CategoryID, a.Original.Tags
			if _, err = applyAutomaticClassification(ctx, tx, e, original); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `UPDATE assistant_classifications SET undone=true WHERE entry_id=$1`, id); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET status='undone',updated_at=now() WHERE entry_id=$1`, id)
			return err
		}
		return &Error{409, "This transaction has changed or was already undone. Your edits were kept"}
	})
}

func existingPaymentCategory(e domain.Entry, categories []domain.Category) string {
	if e.Payment != nil && e.CategoryID == "" {
		for _, c := range categories {
			if !c.Hidden && strings.EqualFold(c.Name, "Recurring") {
				return c.ID
			}
		}
	}
	return ""
}
