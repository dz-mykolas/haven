package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/jackc/pgx/v5"
)

type BankConnection struct {
	ID          string                `json:"id"`
	Bank        string                `json:"bank"`
	Country     string                `json:"country"`
	Environment string                `json:"environment"`
	Status      string                `json:"status"`
	ValidUntil  time.Time             `json:"valid_until"`
	SyncedAt    *time.Time            `json:"synced_at"`
	Accounts    []banking.AccountData `json:"accounts"`
}

func (s *Store) BeginBankAuth(ctx context.Context, state, browser, app string, bank banking.Bank) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM bank_authorizations WHERE expires_at < now()`)
	if err != nil {
		return err
	}
	_, err = s.Pool.Exec(ctx, `INSERT INTO bank_authorizations(state_hash,browser_hash,app_id,bank_name,country) VALUES($1,$2,$3,$4,$5)`, banking.Hash(state), banking.Hash(browser), app, bank.Name, bank.Country)
	return err
}
func (s *Store) ConsumeBankAuth(ctx context.Context, state, browser, app string) (banking.Bank, error) {
	var bank banking.Bank
	err := s.Pool.QueryRow(ctx, `DELETE FROM bank_authorizations WHERE state_hash=$1 AND browser_hash=$2 AND app_id=$3 AND expires_at>now() RETURNING bank_name,country`, banking.Hash(state), banking.Hash(browser), app).Scan(&bank.Name, &bank.Country)
	if errors.Is(err, pgx.ErrNoRows) {
		return bank, &Error{400, "This bank authorization expired or was already used. Start again."}
	}
	return bank, err
}
func (s *Store) SaveBankSession(ctx context.Context, app string, session banking.Session) (string, error) {
	data, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	// A completed consent is an explicit request to add the selected accounts.
	// Serialize with refresh/removal, and detach removed accounts from older
	// sessions before restoring them so stale connections cannot revive.
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728194)`); err != nil {
		return "", err
	}
	if err = pruneRemovedSessionAccounts(ctx, tx, app, session.ASPSP.Name, session.ASPSP.Country); err != nil {
		return "", err
	}
	hashes := make([]string, 0, len(session.Accounts))
	for _, account := range session.Accounts {
		hashes = append(hashes, account.IdentificationHash)
	}
	if _, err = tx.Exec(ctx, `UPDATE bank_ledger_accounts SET removed=false WHERE app_id=$1 AND bank_name=$2 AND country=$3 AND environment='SANDBOX' AND identity_hash=ANY($4::text[]) AND removed`, app, session.ASPSP.Name, session.ASPSP.Country, hashes); err != nil {
		return "", err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO bank_connections(app_id,bank_name,country,session_data,valid_until) VALUES($1,$2,$3,$4,$5) RETURNING id::text`, app, session.ASPSP.Name, session.ASPSP.Country, data, session.Access.ValidUntil).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

// Show useful connections only. Authorization accounts, rather than snapshots,
// distinguish a fresh connection awaiting its first sync from removed accounts.
func (s *Store) BankConnections(ctx context.Context) ([]BankConnection, error) {
	rows, err := s.Pool.Query(ctx, `SELECT id::text,bank_name,country,environment,
 CASE WHEN disconnected THEN 'disconnected' WHEN valid_until<=now() THEN 'expired' ELSE 'connected' END,
 valid_until,synced_at,COALESCE((
   SELECT jsonb_agg(item ORDER BY position)
   FROM jsonb_array_elements(snapshot) WITH ORDINALITY AS items(item,position)
   WHERE NOT EXISTS(SELECT 1 FROM bank_ledger_accounts a
     WHERE a.app_id=bank_connections.app_id AND a.bank_name=bank_connections.bank_name
       AND a.country=bank_connections.country
       AND a.identity_hash=item->'account'->>'identification_hash' AND a.removed)
 ), '[]'::jsonb)
 FROM bank_connections
 WHERE NOT disconnected AND EXISTS (
   SELECT 1 FROM jsonb_array_elements(COALESCE(session_data->'accounts','[]'::jsonb)) AS authorized(account)
   WHERE NOT EXISTS(SELECT 1 FROM bank_ledger_accounts a
     WHERE a.app_id=bank_connections.app_id AND a.bank_name=bank_connections.bank_name
       AND a.country=bank_connections.country AND a.environment=bank_connections.environment
       AND a.identity_hash=account->>'identification_hash' AND a.removed)
 )
 ORDER BY created_at DESC,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []BankConnection{}
	for rows.Next() {
		var conn BankConnection
		var snapshot []byte
		if err := rows.Scan(&conn.ID, &conn.Bank, &conn.Country, &conn.Environment, &conn.Status, &conn.ValidUntil, &conn.SyncedAt, &snapshot); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(snapshot, &conn.Accounts); err != nil {
			return nil, err
		}
		// Session-scoped provider UIDs stay on the server. Stable hashes and bank
		// references remain available to a future reconciliation implementation.
		for i := range conn.Accounts {
			conn.Accounts[i].Account.UID = ""
		}
		result = append(result, conn)
	}
	return result, rows.Err()
}

// Lock a connection through refresh/revocation, so an in-flight refresh cannot
// resurrect a disconnected session or overwrite a newer snapshot.
func (s *Store) UpdateBankConnection(ctx context.Context, id, app string, disconnect bool, client *banking.Client) error {
	return s.mutate(ctx, id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728194)`); err != nil {
			return err
		}
		var data []byte
		var disconnected bool
		var validUntil time.Time
		err := tx.QueryRow(ctx, `SELECT session_data,disconnected,valid_until FROM bank_connections WHERE id=$1 AND app_id=$2 FOR UPDATE`, id, app).Scan(&data, &disconnected, &validUntil)
		if errors.Is(err, pgx.ErrNoRows) {
			return &Error{404, "Bank connection not found for this application"}
		}
		if err != nil {
			return err
		}
		if disconnected {
			if disconnect {
				return nil
			}
			return &Error{409, "This test bank is disconnected"}
		}
		var session banking.Session
		if err := json.Unmarshal(data, &session); err != nil {
			return err
		}
		if disconnect {
			if err := client.Disconnect(ctx, session.ID); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `UPDATE bank_connections SET disconnected=true,session_data='{}' WHERE id=$1`, id)
			return err
		}
		if !validUntil.After(time.Now()) {
			return &Error{409, "This test session expired. Connect the bank again."}
		}
		session, err = filterRemovedBankAccounts(ctx, tx, app, session)
		if err != nil {
			return err
		}
		if len(session.Accounts) == 0 {
			return &Error{409, "All accounts in this connection were removed. Connect a test bank to add other accounts."}
		}
		snapshot, err := client.Snapshot(ctx, session)
		if err != nil {
			return err
		}
		if err := importBankLedger(ctx, tx, app, session.ASPSP.Name, session.ASPSP.Country, snapshot); err != nil {
			return err
		}
		encoded, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE bank_connections SET snapshot=$2,synced_at=now() WHERE id=$1`, id, encoded)
		return err
	})
}
