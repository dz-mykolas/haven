package store

import (
	"context"
	"errors"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

// Removal is local to Haven. Keep a tombstone and existing transfer history,
// but exclude the account from Money and all subsequent provider fetches.
func (s *Store) RemoveAccount(ctx context.Context, id string, version int64) error {
	if version < 1 {
		return bad("Account version is required")
	}
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728194)`); err != nil {
			return err
		}
		var current int64
		var removed bool
		err := tx.QueryRow(ctx, `SELECT version,removed FROM accounts WHERE id=$1 FOR UPDATE`, id).Scan(&current, &removed)
		if err == nil {
			if removed {
				return nil
			}
			if current != version {
				return conflict(current)
			}
			_, err = tx.Exec(ctx, `UPDATE accounts SET removed=true,version=version+1 WHERE id=$1`, id)
			return err
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		err = tx.QueryRow(ctx, `SELECT removed FROM bank_ledger_accounts WHERE id=$1 FOR UPDATE`, id).Scan(&removed)
		if errors.Is(err, pgx.ErrNoRows) {
			return &Error{404, "Account not found"}
		}
		if err != nil {
			return err
		}
		if removed {
			return nil
		}
		if version != 1 {
			return conflict(1)
		}
		_, err = tx.Exec(ctx, `UPDATE bank_ledger_accounts SET removed=true WHERE id=$1`, id)
		return err
	})
}

func visibleEntries(accounts []domain.Account, entries []domain.Entry) []domain.Entry {
	active := map[string]bool{}
	for _, a := range accounts {
		active[a.ID] = true
	}
	visible := make([]domain.Entry, 0, len(entries))
	for _, e := range entries {
		// Keep the other side of transfers without turning them into income/spending.
		if active[e.AccountID] || (e.Kind == "transfer" && active[e.DestinationID]) {
			visible = append(visible, e)
		}
	}
	return visible
}

func filterRemovedBankAccounts(ctx context.Context, tx pgx.Tx, app string, session banking.Session) (banking.Session, error) {
	rows, err := tx.Query(ctx, `SELECT identity_hash FROM bank_ledger_accounts WHERE app_id=$1 AND bank_name=$2 AND country=$3 AND removed`, app, session.ASPSP.Name, session.ASPSP.Country)
	if err != nil {
		return session, err
	}
	hashes, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return session, err
	}
	removed := map[string]bool{}
	for _, hash := range hashes {
		removed[hash] = true
	}
	active := make([]banking.Account, 0, len(session.Accounts))
	for _, a := range session.Accounts {
		if !removed[a.IdentificationHash] {
			active = append(active, a)
		}
	}
	session.Accounts = active
	return session, nil
}

// Before a new consent restores accounts, retire their references in older
// consent sessions. Money's ledger and personal annotations remain untouched.
func pruneRemovedSessionAccounts(ctx context.Context, tx pgx.Tx, app, bank, country string) error {
	_, err := tx.Exec(ctx, `UPDATE bank_connections c SET
 session_data=jsonb_set(session_data,'{accounts}',COALESCE((
   SELECT jsonb_agg(account ORDER BY position)
   FROM jsonb_array_elements(COALESCE(session_data->'accounts','[]'::jsonb)) WITH ORDINALITY AS authorized(account,position)
   WHERE NOT EXISTS(SELECT 1 FROM bank_ledger_accounts a
     WHERE a.app_id=c.app_id AND a.bank_name=c.bank_name AND a.country=c.country AND a.environment=c.environment
       AND a.identity_hash=account->>'identification_hash' AND a.removed)
 ),'[]'::jsonb)),
 snapshot=COALESCE((SELECT jsonb_agg(item ORDER BY position)
   FROM jsonb_array_elements(snapshot) WITH ORDINALITY AS items(item,position)
   WHERE NOT EXISTS(SELECT 1 FROM bank_ledger_accounts a
     WHERE a.app_id=c.app_id AND a.bank_name=c.bank_name AND a.country=c.country AND a.environment=c.environment
       AND a.identity_hash=item->'account'->>'identification_hash' AND a.removed)
 ),'[]'::jsonb)
 WHERE app_id=$1 AND bank_name=$2 AND country=$3 AND NOT disconnected
 AND EXISTS(SELECT 1 FROM bank_ledger_accounts a
   WHERE a.app_id=c.app_id AND a.bank_name=c.bank_name AND a.country=c.country AND a.environment=c.environment AND a.removed)`, app, bank, country)
	return err
}
