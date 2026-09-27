package store

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"strings"
	"unicode/utf8"
)

func (s *Store) AnswerReview(ctx context.Context, id, answer string) error {
	answer = strings.TrimSpace(answer)
	if answer == "" || utf8.RuneCountInString(answer) > 1000 {
		return bad("Use an answer between 1 and 1,000 characters")
	}
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		snap, err := reviewSnapshot(ctx, tx)
		if err != nil {
			return err
		}
		settings, err := assistantSettings(ctx, tx, true)
		if err != nil {
			return err
		}
		if settings.Authorize("review-transaction", "transaction_imported") != nil {
			return bad("Enable Suggest too to continue this review")
		}
		item, err := one[ReviewItem](ctx, tx, `SELECT entry_id::text,original,draft,status,created_at,reason,question FROM assistant_reviews WHERE entry_id=$1 FOR UPDATE`, id)
		if err != nil || item.Status != "review" || item.Question == "" {
			return &Error{409, "This question has already been handled"}
		}
		for _, e := range snap.Entries {
			if e.ID != id || !sameReviewEntry(e, item.Original) {
				continue
			}
			raw, err := json.Marshal(e)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `UPDATE assistant_reviews SET answer=$2,original=$3,status='queued',question='',attempts=0,available_at=now(),updated_at=now() WHERE entry_id=$1`, id, answer, raw)
			return err
		}
		return &Error{409, "This transaction changed. Refresh the inbox before answering"}
	})
}
