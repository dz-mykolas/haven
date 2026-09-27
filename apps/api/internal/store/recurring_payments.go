package store

import (
	"context"
	"errors"
	"strings"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

func paymentKey(e domain.Entry) string {
	key := strings.ToLower(strings.Join(strings.Fields(e.Payee), " "))
	if key == "" {
		return "entry:" + e.ID
	}
	return key
}

// Associations reuse a user-accepted schedule. Matching a name never infers
// recurrence or creates a schedule on its own.
func attachPayments(ctx context.Context, tx pgx.Tx, entries []domain.Entry, tasks []domain.Task) error {
	byID := map[string]*domain.Task{}
	for i := range tasks {
		t := &tasks[i]
		if !t.Deleted && !t.Done && t.Kind == "payment" && (t.Repeat != "none" || t.Forecast()) {
			byID[t.ID] = t
		}
	}
	rows, err := tx.Query(ctx, `SELECT account_id::text,payee_key,task_id::text FROM recurring_payment_links`)
	if err != nil {
		return err
	}
	legacy := map[string][]*domain.Task{}
	for rows.Next() {
		var account, payee, id string
		if err = rows.Scan(&account, &payee, &id); err != nil {
			rows.Close()
			return err
		}
		if t := byID[id]; t != nil {
			legacy[account+":"+payee] = append(legacy[account+":"+payee], t)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = tx.Query(ctx, `SELECT entry_id::text,task_id::text,purchased_units FROM transaction_payment_links`)
	if err != nil {
		return err
	}
	defer rows.Close()
	explicit := map[string]*domain.Task{}
	units := map[string]int{}
	for rows.Next() {
		var id, task string
		var quantity int
		if err = rows.Scan(&id, &task, &quantity); err != nil {
			return err
		}
		explicit[id] = byID[task]
		units[id] = quantity
	}
	for i := range entries {
		e := &entries[i]
		if e.Kind == "transfer" {
			continue
		}
		if t, ok := explicit[e.ID]; ok {
			e.Payment = t
			e.PaymentUnits = units[e.ID]
			continue
		}
		// Charges attach to costs and incoming money to income plans.
		matches := []*domain.Task{}
		for _, t := range legacy[e.AccountID+":"+paymentKey(*e)] {
			if t.Income == (e.Kind == "income") {
				matches = append(matches, t)
			}
		}
		// Forecast products always require a product match, never merchant-only reuse.
		if len(matches) == 1 && !matches[0].Forecast() {
			e.Payment = matches[0]
		}
	}
	return rows.Err()
}

func saveEntryPayment(ctx context.Context, tx pgx.Tx, e domain.Entry, proposed *domain.Task) (*domain.Task, error) {
	if proposed == nil {
		return nil, nil
	}
	if e.Kind == "transfer" || e.Deleted || proposed.Kind != "payment" || (proposed.Repeat == "none" && !proposed.Forecast()) || proposed.Done || proposed.Deleted {
		return nil, bad("Choose an active payment plan for this transaction")
	}
	if proposed.Income != (e.Kind == "income") {
		return nil, bad("Link income to an income plan and costs to a cost plan")
	}
	if err := proposed.Validate(); err != nil {
		return nil, bad(err.Error())
	}
	// An identical product can have many charges; one merchant can sell multiple products.
	matches, err := list[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id IN (SELECT task_id FROM recurring_payment_links WHERE account_id=$1 AND payee_key=$2) AND NOT deleted AND NOT done AND lower(title)=lower($3) ORDER BY id FOR UPDATE`, e.AccountID, paymentKey(e), proposed.Title)
	if err != nil {
		return nil, err
	}
	saved := *proposed
	if proposed.Version == 0 && len(matches) > 0 {
		saved = matches[0]
	} else {
		saved, err = saveTask(ctx, tx, saved)
		if err != nil {
			return nil, err
		}
	}
	var linkedID string
	err = tx.QueryRow(ctx, `SELECT task_id::text FROM transaction_payment_links WHERE entry_id=$1`, e.ID).Scan(&linkedID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if linkedID != "" && linkedID != saved.ID {
		return nil, bad("This transaction already belongs to another payment plan")
	}
	if linkedID == "" && saved.Forecast() && proposed.Version > 0 {
		if e.PaymentUnits < 1 {
			return nil, bad("Confirm the purchased quantity before linking this charge")
		}
		saved, err = domain.Purchased(saved, e.Date, e.PaymentUnits)
		if err != nil {
			return nil, bad(err.Error())
		}
		saved.Version++
		if err = putTask(ctx, tx, saved); err != nil {
			return nil, err
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO transaction_payment_links(entry_id,task_id,purchased_units) VALUES($1,$2,$3) ON CONFLICT(entry_id) DO NOTHING`, e.ID, saved.ID, e.PaymentUnits)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO recurring_payment_links(account_id,payee_key,task_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, e.AccountID, paymentKey(e), saved.ID)
	// Merchant-wide promotion is reserved for legacy fixed schedules. Product
	// forecasts only change transactions explicitly assigned to that product.
	if err == nil && !saved.Forecast() {
		err = classifyArrangementHistory(ctx, tx, e)
	}
	return &saved, err
}
