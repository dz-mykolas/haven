package store

import (
	"context"
	"encoding/json"
	"math/big"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

const bankSource = "enable_banking_sandbox"

var decimalAmount = regexp.MustCompile(`^-?[0-9]+(?:\.[0-9]+)?$`)

// Parse exact decimal amounts; never round excess fractional cents or use floats.
func euroMinor(a banking.Amount) (int64, error) {
	if a.Currency != "EUR" || len(a.Amount) > 50 || !decimalAmount.MatchString(a.Amount) {
		return 0, bad("Bank import requires EUR amounts with exact cents")
	}
	r, ok := new(big.Rat).SetString(a.Amount)
	if !ok {
		return 0, bad("Invalid bank amount")
	}
	r.Mul(r, big.NewRat(100, 1))
	if !r.IsInt() || !r.Num().IsInt64() {
		return 0, bad("Bank amount has unsupported precision or size")
	}
	n := r.Num().Int64()
	if n < -domain.MaxAmount || n > domain.MaxAmount {
		return 0, bad("Bank amount exceeds the supported range")
	}
	return n, nil
}

func bookedBalance(balances []banking.Balance) (int64, error) {
	// Available balances include holds/credit limits; only accounting balances
	// belong in this booked ledger. Prefer intraday over closing accounting.
	for _, kind := range []string{"ITBD", "CLBD"} {
		var chosen *banking.Balance
		for i := range balances {
			b := &balances[i]
			if b.Type != kind || b.Amount.Currency != "EUR" {
				continue
			}
			if b.ReferenceDate != "" && !domain.ValidDate(b.ReferenceDate) {
				return 0, bad("Bank balance has an invalid date")
			}
			if chosen == nil || b.ReferenceDate > chosen.ReferenceDate {
				chosen = b
			}
		}
		if chosen != nil {
			n, err := euroMinor(chosen.Amount)
			if err != nil {
				return 0, err
			}
			for _, b := range balances {
				if b.Type == kind && b.Amount.Currency == "EUR" && b.ReferenceDate == chosen.ReferenceDate {
					other, e := euroMinor(b.Amount)
					if e != nil {
						return 0, e
					}
					if other != n {
						return 0, bad("Bank returned conflicting booked balances")
					}
				}
			}
			return n, nil
		}
	}
	return 0, bad("Bank did not supply a EUR booked balance; previous Money data was kept")
}

func validateBooked(t banking.Transaction) (int64, error) {
	if strings.TrimSpace(t.Reference) == "" {
		return 0, bad("A booked transaction has no stable reference; previous Money data was kept")
	}
	if !domain.ValidDate(t.BookingDate) {
		return 0, bad("A booked transaction has no valid booking date; previous Money data was kept")
	}
	if t.Direction != "DBIT" && t.Direction != "CRDT" {
		return 0, bad("Bank transaction has an unsupported direction")
	}
	n, err := euroMinor(t.Amount)
	if err != nil {
		return 0, err
	}
	if n <= 0 {
		return 0, bad("Bank transaction amount must be positive")
	}
	return n, nil
}

func importBankLedger(ctx context.Context, tx pgx.Tx, app, bank, country string, snapshot []banking.AccountData) error {
	// Different/reconnected sessions may refer to the same accounts. Serialize
	// imports across sessions, in addition to the per-connection refresh lock.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728194)`); err != nil {
		return err
	}
	seenAccounts := map[string]bool{}
	for _, item := range snapshot {
		a := item.Account
		var removed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bank_ledger_accounts WHERE app_id=$1 AND bank_name=$2 AND country=$3 AND identity_hash=$4 AND removed)`, app, bank, country, a.IdentificationHash).Scan(&removed); err != nil {
			return err
		}
		if removed {
			continue
		}
		if a.Currency != "EUR" || strings.TrimSpace(a.IdentificationHash) == "" {
			return bad("Bank import requires EUR accounts with stable identifiers")
		}
		if seenAccounts[a.IdentificationHash] {
			return bad("Bank returned the same account more than once")
		}
		seenAccounts[a.IdentificationHash] = true
		balance, err := bookedBalance(item.Balances)
		if err != nil {
			return err
		}
		name := strings.TrimSpace(a.Details)
		if name == "" {
			name = strings.TrimSpace(a.Name)
		}
		if name == "" {
			name = bank
		}
		var accountID string
		err = tx.QueryRow(ctx, `INSERT INTO bank_ledger_accounts(app_id,bank_name,country,environment,identity_hash,name,currency,iban,balance_minor)
   VALUES($1,$2,$3,'SANDBOX',$4,$5,'EUR',$6,$7)
   ON CONFLICT(app_id,bank_name,country,environment,identity_hash) DO UPDATE
   SET name=EXCLUDED.name,iban=EXCLUDED.iban,balance_minor=EXCLUDED.balance_minor,synced_at=now() RETURNING id::text`, app, bank, country, a.IdentificationHash, name, a.AccountID.IBAN, balance).Scan(&accountID)
		if err != nil {
			return err
		}
		seen := map[string]banking.Transaction{}
		for _, t := range item.Transactions {
			// Pending records can change identifiers or disappear. Keep them in the raw
			// connection snapshot only; they never affect booked spending or balances.
			if t.Status != "BOOK" {
				continue
			}
			if _, err := validateBooked(t); err != nil {
				return err
			}
			if old, ok := seen[t.Reference]; ok && !reflect.DeepEqual(old, t) {
				return bad("Bank returned conflicting transactions with the same reference")
			}
			seen[t.Reference] = t
			payload, err := json.Marshal(t)
			if err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO bank_ledger_transactions(account_id,reference,payload) VALUES($1,$2,$3)
    ON CONFLICT(account_id,reference) DO UPDATE SET payload=EXCLUDED.payload
    WHERE bank_ledger_transactions.payload IS DISTINCT FROM EXCLUDED.payload`, accountID, t.Reference, payload); err != nil {
				return err
			}
		}
	}
	// Do not delete older booked history merely because a bank's fetch window moved.
	return nil
}

type ledgerAccount struct {
	Removed bool   `db:"removed"`
	ID      string `db:"id"`
	Name    string `db:"name"`
	IBAN    string `db:"iban"`
	Balance int64  `db:"balance_minor"`
	App     string `db:"app_id"`
}
type ledgerTransaction struct {
	CategoryID string   `db:"category_id"`
	Category   string   `db:"category"`
	Tags       []string `db:"tags"`
	Notes      string   `db:"notes"`
	Version    int64    `db:"version"`
	ID         string   `db:"id"`
	AccountID  string   `db:"account_id"`
	Payload    []byte   `db:"payload"`
}

func appendBankLedger(ctx context.Context, tx pgx.Tx, accounts []domain.Account, entries []domain.Entry) ([]domain.Account, []domain.Entry, error) {
	return appendBankLedgerWindow(ctx, tx, accounts, entries, "", "")
}
func appendBankLedgerWindow(ctx context.Context, tx pgx.Tx, accounts []domain.Account, entries []domain.Entry, from, to string) ([]domain.Account, []domain.Entry, error) {
	a, err := list[ledgerAccount](ctx, tx, `SELECT id::text,name,iban,balance_minor,app_id,removed FROM bank_ledger_accounts ORDER BY name,id`)
	if err != nil {
		return nil, nil, err
	}
	rows, err := list[ledgerTransaction](ctx, tx, `SELECT id::text,account_id::text,payload,COALESCE(category_id::text,'') AS category_id,COALESCE((SELECT name FROM money_categories WHERE id=category_id),'') AS category,tags,notes,annotation_version AS version FROM bank_ledger_transactions WHERE ($1='' OR payload->>'booking_date' BETWEEN $1 AND $2) ORDER BY id`, from, to)
	if err != nil {
		return nil, nil, err
	}
	for _, item := range a {
		if item.Removed {
			continue
		}
		balance := item.Balance
		accounts = append(accounts, domain.Account{ID: item.ID, Name: item.Name, Currency: "EUR", BankBalance: &balance, Source: bankSource, Version: 1})
	}
	imported, err := projectBankEntries(a, rows)
	if err != nil {
		return nil, nil, err
	}
	entries = append(entries, imported...)
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Date == entries[j].Date {
			return entries[i].ID < entries[j].ID
		}
		return entries[i].Date > entries[j].Date
	})
	return accounts, entries, nil
}

func normalized(s string) string { return strings.ToLower(strings.Join(strings.Fields(s), " ")) }
func iban(s string) string       { return strings.ToUpper(strings.Join(strings.Fields(s), "")) }

func projectBankEntries(accounts []ledgerAccount, rows []ledgerTransaction) ([]domain.Entry, error) {
	byID := map[string]ledgerAccount{}
	byIBAN, byName := map[string][]string{}, map[string][]string{}
	for _, a := range accounts {
		byID[a.ID] = a
		if key := iban(a.IBAN); key != "" {
			byIBAN[a.App+":"+key] = append(byIBAN[a.App+":"+key], a.ID)
		}
		if key := normalized(a.Name); key != "" {
			byName[a.App+":"+key] = append(byName[a.App+":"+key], a.ID)
		}
	}
	entries := make([]domain.Entry, len(rows))
	targets := make([]string, len(rows))
	// Candidates are indexed by both account endpoints, amount and booking day.
	// Stop counting at two: ambiguous matches are deliberately left untouched.
	type key struct {
		from, to string
		amount   int64
		day      string
	}
	type candidate struct{ index, count int }
	incoming, outgoing := map[key]candidate{}, map[key]candidate{}
	add := func(m map[key]candidate, k key, i int) {
		c := m[k]
		c.index = i
		if c.count < 2 {
			c.count++
		}
		m[k] = c
	}
	for i, row := range rows {
		var t banking.Transaction
		if err := json.Unmarshal(row.Payload, &t); err != nil {
			return nil, err
		}
		amount, err := validateBooked(t)
		if err != nil {
			return nil, err
		}
		kind, payee, other := "expense", t.Creditor.Name, t.CreditorAccount.IBAN
		if t.Direction == "CRDT" {
			kind, payee, other = "income", t.Debtor.Name, t.DebtorAccount.IBAN
		}
		entries[i] = domain.Entry{ID: row.ID, AccountID: row.AccountID, Kind: kind, Amount: amount, Date: t.BookingDate, Payee: payee, CategoryID: row.CategoryID, Category: row.Category, Tags: row.Tags, Notes: row.Notes, BankDescription: strings.Join(t.Remittance, "\n"), Source: bankSource, Version: row.Version}
		account := byID[row.AccountID]
		var matches []string
		if iban(other) != "" {
			matches = byIBAN[account.App+":"+iban(other)]
		} else {
			// Mock accounts may not have IBANs. Exact, unique reciprocal account labels
			// are a sandbox-only fallback, never a generic amount-only heuristic.
			matches = byName[account.App+":"+normalized(payee)]
		}
		if len(matches) != 1 || matches[0] == row.AccountID {
			continue
		}
		targets[i] = matches[0]
		k := key{row.AccountID, targets[i], amount, t.BookingDate}
		if kind == "income" {
			k.from, k.to = k.to, k.from
			add(incoming, k, i)
		} else {
			add(outgoing, k, i)
		}
	}
	find := func(m map[key]candidate, from, to string, amount int64, day string) candidate {
		date, _ := time.Parse("2006-01-02", day)
		result := candidate{}
		for delta := -3; delta <= 3; delta++ {
			c := m[key{from, to, amount, date.AddDate(0, 0, delta).Format("2006-01-02")}]
			result.count += c.count
			if c.count > 0 {
				result.index = c.index
			}
			if result.count > 1 {
				return result
			}
		}
		return result
	}
	hidden := map[int]bool{}
	for i, e := range entries {
		if e.Kind != "expense" || targets[i] == "" {
			continue
		}
		other := find(incoming, e.AccountID, targets[i], e.Amount, e.Date)
		if other.count != 1 {
			continue
		}
		credit := entries[other.index]
		reverse := find(outgoing, e.AccountID, targets[i], e.Amount, credit.Date)
		if reverse.count != 1 || reverse.index != i {
			continue
		}
		entries[i].Kind = "transfer"
		entries[i].DestinationID = credit.AccountID
		entries[i].Payee = "Transfer"
		hidden[other.index] = true
	}
	result := []domain.Entry{}
	for i, e := range entries {
		if !hidden[i] {
			result = append(result, e)
		}
	}
	return result, nil
}

// Even if a caller strips source metadata, bank-owned IDs cannot be overwritten
// through the manual record endpoints.
func protectBankRecord(ctx context.Context, tx pgx.Tx, id string) error {
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bank_ledger_accounts WHERE id=$1 UNION ALL SELECT 1 FROM bank_ledger_transactions WHERE id=$1)`, id).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return bad("Bank records are managed by sync")
	}
	return nil
}
