package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// BankLogo is a cached bank logo. Empty Data means the bank has no logo.
type BankLogo struct {
	Data        []byte
	ContentType string
	FetchedAt   time.Time
}

// AccountBank returns the bank and country of a bank-synced account.
func (s *Store) AccountBank(ctx context.Context, id string) (string, string, error) {
	var name, country string
	err := s.Pool.QueryRow(ctx, `SELECT bank_name, country FROM bank_ledger_accounts WHERE id::text=$1 AND NOT removed`, id).Scan(&name, &country)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", &Error{404, "This account has no bank logo"}
	}
	return name, country, err
}

// CachedBankLogo returns the stored logo, if the bank has been looked up.
func (s *Store) CachedBankLogo(ctx context.Context, name, country string) (BankLogo, bool, error) {
	var logo BankLogo
	err := s.Pool.QueryRow(ctx, `SELECT data, content_type, fetched_at FROM bank_logos WHERE bank_name=$1 AND country=$2`, name, country).
		Scan(&logo.Data, &logo.ContentType, &logo.FetchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return logo, false, nil
	}
	return logo, err == nil, err
}

// SaveBankLogo stores a downloaded logo, or an empty one when the bank has none.
func (s *Store) SaveBankLogo(ctx context.Context, name, country string, data []byte, contentType string) error {
	if data == nil {
		data = []byte{}
	}
	_, err := s.Pool.Exec(ctx, `INSERT INTO bank_logos(bank_name, country, content_type, data, fetched_at) VALUES($1,$2,$3,$4,now())
		ON CONFLICT (bank_name, country) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, fetched_at=now()`,
		name, country, contentType, data)
	return err
}
