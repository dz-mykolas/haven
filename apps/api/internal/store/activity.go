package store

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

type ActivityFilter struct {
	Month    string
	Account  string
	Category string
	Tag      string
	Search   string
	Payment  string
	Unlinked bool
}
type ActivityPage struct {
	Items      []domain.Entry `json:"items"`
	Total      int            `json:"total"`
	NextCursor string         `json:"next_cursor"`
}

func (s *Store) Activity(ctx context.Context, filter ActivityFilter, cursor string) (ActivityPage, error) {
	out := ActivityPage{Items: []domain.Entry{}}
	scope := cursorScope(filter)
	after, err := decodeCursor(cursor, scope)
	if err != nil {
		return out, err
	}
	// Use the canonical projection: independent paging of bank debits/credits
	// would lose reciprocal transfer matches and change the financial meaning.
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	from, to, bankFrom, bankTo := "", "", "", ""
	if filter.Month != "" {
		start, _ := time.Parse("2006-01", filter.Month)
		end := start.AddDate(0, 1, 0)
		from, to = start.Format("2006-01-02"), end.Format("2006-01-02")
		// Matching searches +/-3 days in both directions. Keep both candidate
		// neighborhoods so month boundaries never turn a transfer into spending.
		bankFrom, bankTo = start.AddDate(0, 0, -6).Format("2006-01-02"), end.AddDate(0, 0, 6).Format("2006-01-02")
	}
	accounts, err := list[domain.Account](ctx, tx, `SELECT `+accountCols+` FROM accounts WHERE NOT removed ORDER BY name,id`)
	if err != nil {
		return out, err
	}
	entries, err := list[domain.Entry](ctx, tx, `SELECT `+entryCols+` FROM entries WHERE NOT deleted AND ($1='' OR (date>=NULLIF($1,'')::date AND date<NULLIF($2,'')::date)) ORDER BY date DESC,id`, from, to)
	if err != nil {
		return out, err
	}
	accounts, entries, err = appendBankLedgerWindow(ctx, tx, accounts, entries, bankFrom, bankTo)
	if err != nil {
		return out, err
	}
	tasks, err := list[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE NOT deleted ORDER BY id`)
	if err != nil {
		return out, err
	}
	if err = attachPayments(ctx, tx, entries, tasks); err != nil {
		return out, err
	}
	for _, e := range visibleEntries(accounts, entries) {
		if filter.Month != "" && !strings.HasPrefix(e.Date, filter.Month) {
			continue
		}
		if filter.Account != "" && e.AccountID != filter.Account && e.DestinationID != filter.Account {
			continue
		}
		if filter.Category == "uncategorized" {
			if e.CategoryID != "" {
				continue
			}
		} else if filter.Category != "" && e.CategoryID != filter.Category {
			continue
		}
		if filter.Tag != "" {
			found := false
			for _, tag := range e.Tags {
				if tag == filter.Tag {
					found = true
				}
			}
			if !found {
				continue
			}
		}
		if filter.Payment != "" && (e.Payment == nil || e.Payment.ID != filter.Payment) {
			continue
		}
		if filter.Unlinked && (e.Payment != nil || e.Kind != "expense") {
			continue
		}
		if !strings.Contains(strings.ToLower(e.Payee+" "+e.Category+" "+e.Notes+" "+e.BankDescription+" "+strings.Join(e.Tags, " ")), strings.ToLower(filter.Search)) {
			continue
		}
		out.Total++
		if cursor != "" && (e.Date > after.Date || (e.Date == after.Date && e.ID <= after.ID)) {
			continue
		}
		out.Items = append(out.Items, e)
	}
	sort.Slice(out.Items, func(i, j int) bool {
		a, b := out.Items[i], out.Items[j]
		if a.Date != b.Date {
			return a.Date > b.Date
		}
		return a.ID < b.ID
	})
	if len(out.Items) > FeedPageSize {
		out.Items = out.Items[:FeedPageSize]
		last := out.Items[len(out.Items)-1]
		out.NextCursor = encodeCursor(feedCursor{Scope: scope, Date: last.Date, ID: last.ID})
	}
	return out, tx.Commit(ctx)
}
