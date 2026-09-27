package store

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

func classificationLock(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728195)`)
	return err
}
func classificationCatalog(ctx context.Context, tx pgx.Tx) ([]domain.Category, []string, error) {
	cats, err := list[domain.Category](ctx, tx, `SELECT id::text,name,hidden,version FROM money_categories ORDER BY lower(name),id`)
	if err != nil {
		return nil, nil, err
	}
	rows, err := tx.Query(ctx, `SELECT name FROM money_tags ORDER BY key`)
	if err != nil {
		return nil, nil, err
	}
	tags, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if tags == nil {
		tags = []string{}
	}
	return cats, tags, err
}
func normalizeClassification(ctx context.Context, tx pgx.Tx, categoryID, category *string, tags *[]string, notes, oldCategoryID string) error {
	if utf8.RuneCountInString(notes) > 4000 || len(*tags) > 128 {
		return bad("Use up to 12 tags and 4,000 characters of notes")
	}
	*category = ""
	if *categoryID != "" {
		if !domain.ValidID(*categoryID) {
			return bad("Choose a valid category")
		}
		var hidden bool
		err := tx.QueryRow(ctx, `SELECT name,hidden FROM money_categories WHERE id=$1`, *categoryID).Scan(category, &hidden)
		if errors.Is(err, pgx.ErrNoRows) {
			return bad("Category no longer exists")
		}
		if err != nil {
			return err
		}
		if hidden && oldCategoryID != *categoryID {
			return bad("This category is hidden; choose another category")
		}
	}
	normalizedTags := []string{}
	seen := map[string]bool{}
	for _, tag := range *tags {
		name := strings.Join(strings.Fields(tag), " ")
		key := strings.ToLower(name)
		if name == "" || utf8.RuneCountInString(name) > 40 {
			return bad("Use tag names between 1 and 40 characters")
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		if len(normalizedTags) >= 12 {
			return bad("Use up to 12 tags per transaction")
		}
		var canonical string
		err := tx.QueryRow(ctx, `INSERT INTO money_tags(key,name) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET key=EXCLUDED.key RETURNING name`, key, name).Scan(&canonical)
		if err != nil {
			return err
		}
		normalizedTags = append(normalizedTags, canonical)
	}
	*tags = normalizedTags
	return nil
}
func (s *Store) SaveCategory(ctx context.Context, c domain.Category) (domain.Category, error) {
	c.Name = strings.Join(strings.Fields(c.Name), " ")
	if !domain.ValidID(c.ID) || c.Name == "" || utf8.RuneCountInString(c.Name) > 60 || strings.EqualFold(c.Name, "Uncategorized") {
		return c, bad("Use a category name between 1 and 60 characters; Uncategorized is reserved")
	}
	err := s.mutate(ctx, c.ID, func(tx pgx.Tx) error {
		if err := classificationLock(ctx, tx); err != nil {
			return err
		}
		old, err := one[domain.Category](ctx, tx, `SELECT id::text,name,hidden,version FROM money_categories WHERE id=$1 FOR UPDATE`, c.ID)
		v := c.Version
		c.Version = old.Version
		write, err := revision(old, c, old.Version, v, err)
		if err != nil {
			return err
		}
		if !write {
			c = old
			return nil
		}
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM money_categories WHERE lower(name)=lower($1) AND id<>$2)`, c.Name, c.ID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return &Error{409, "A category with that name already exists"}
		}
		c.Version = v + 1
		_, err = tx.Exec(ctx, `INSERT INTO money_categories(id,name,hidden,version) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=$2,hidden=$3,version=$4`, c.ID, c.Name, c.Hidden, c.Version)
		return err
	})
	return c, err
}

type BankAnnotations struct {
	PaymentUnits int          `json:"payment_units,omitempty"`
	Payment      *domain.Task `json:"payment,omitempty"`
	CategoryID   string       `json:"category_id"`
	Tags         []string     `json:"tags"`
	Notes        string       `json:"notes"`
	Version      int64        `json:"version"`
}

func (s *Store) SaveBankAnnotations(ctx context.Context, id string, a BankAnnotations) (BankAnnotations, error) {
	err := s.mutate(ctx, id, func(tx pgx.Tx) error {
		snap, err := reviewSnapshot(ctx, tx)
		if err != nil {
			return err
		}
		var entry domain.Entry
		for _, e := range snap.Entries {
			if e.ID == id {
				entry = e
				break
			}
		}
		var version int64
		var oldCategory string
		err = tx.QueryRow(ctx, `SELECT annotation_version,COALESCE(category_id::text,'') FROM bank_ledger_transactions WHERE id=$1 FOR UPDATE`, id).Scan(&version, &oldCategory)
		if errors.Is(err, pgx.ErrNoRows) {
			return &Error{404, "Bank transaction not found"}
		}
		if err != nil {
			return err
		}
		if version != a.Version {
			return conflict(version)
		}
		var category string
		if err = normalizeClassification(ctx, tx, &a.CategoryID, &category, &a.Tags, a.Notes, oldCategory); err != nil {
			return err
		}
		a.Version++
		_, err = tx.Exec(ctx, `UPDATE bank_ledger_transactions SET category_id=NULLIF($2,'')::uuid,tags=$3,notes=$4,annotation_version=$5 WHERE id=$1`, id, a.CategoryID, a.Tags, a.Notes, a.Version)
		if err != nil {
			return err
		}
		entry.PaymentUnits = a.PaymentUnits
		a.Payment, err = saveEntryPayment(ctx, tx, entry, a.Payment)
		if err != nil {
			return err
		}
		return completeReview(ctx, tx, id)
	})
	return a, err
}
