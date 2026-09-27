package store

import (
	"encoding/json"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

func TestExactBankAmounts(t *testing.T) {
	for _, test := range []struct {
		raw   string
		want  int64
		valid bool
	}{{"0.01", 1, true}, {"-3049.23", -304923, true}, {"1.2300", 123, true}, {"90000000000.00", domain.MaxAmount, true}, {"0.001", 0, false}, {"NaN", 0, false}, {"1e2", 0, false}, {"90000000000.01", 0, false}, {"9999999999999999999999999", 0, false}} {
		got, err := euroMinor(banking.Amount{Amount: test.raw, Currency: "EUR"})
		if (err == nil) != test.valid || (test.valid && got != test.want) {
			t.Fatalf("%s: got %d %v", test.raw, got, err)
		}
	}
	if _, err := euroMinor(banking.Amount{Amount: "1", Currency: "USD"}); err == nil {
		t.Fatal("accepted foreign currency")
	}
}
func TestBookBalanceSelection(t *testing.T) {
	amount := func(n string) banking.Amount { return banking.Amount{Amount: n, Currency: "EUR"} }
	balances := []banking.Balance{{Type: "CLAV", Amount: amount("100")}, {Type: "CLBD", Amount: amount("20"), ReferenceDate: "2026-09-20"}, {Type: "CLBD", Amount: amount("30"), ReferenceDate: "2026-09-21"}}
	if got, err := bookedBalance(balances); err != nil || got != 3000 {
		t.Fatalf("wrong booked balance %d %v", got, err)
	}
	if _, err := bookedBalance(balances[:1]); err == nil {
		t.Fatal("used available balance")
	}
	balances = append(balances, banking.Balance{Type: "CLBD", Amount: amount("40"), ReferenceDate: "2026-09-21"})
	if _, err := bookedBalance(balances); err == nil {
		t.Fatal("accepted ambiguous balances")
	}
}
func TestConservativeTransferMatching(t *testing.T) {
	accounts := []ledgerAccount{{ID: "a", Name: "SEB", IBAN: "LT001", App: "app"}, {ID: "b", Name: "Revolut", IBAN: "LT002", App: "app"}}
	row := func(id, account, direction, payee, date string) ledgerTransaction {
		tr := banking.Transaction{Reference: id, Status: "BOOK", Direction: direction, BookingDate: date, Amount: banking.Amount{Amount: "200.00", Currency: "EUR"}}
		if direction == "DBIT" {
			tr.Creditor.Name = payee
		} else {
			tr.Debtor.Name = payee
		}
		data, _ := json.Marshal(tr)
		return ledgerTransaction{ID: id, AccountID: account, Payload: data}
	}
	debit := row("d", "a", "DBIT", "Revolut", "2026-09-18")
	credit := row("c", "b", "CRDT", "SEB", "2026-09-19")
	tests := []struct {
		name     string
		rows     []ledgerTransaction
		want     int
		transfer bool
	}{
		{"reciprocal account names", []ledgerTransaction{debit, credit}, 1, true},
		{"amount alone is not evidence", []ledgerTransaction{debit, row("c", "b", "CRDT", "Employer", "2026-09-19")}, 2, false},
		{"ambiguous incoming", []ledgerTransaction{debit, credit, row("c2", "b", "CRDT", "SEB", "2026-09-18")}, 3, false},
		{"ambiguous outgoing", []ledgerTransaction{debit, credit, row("d2", "a", "DBIT", "Revolut", "2026-09-19")}, 3, false},
		{"outside booking window", []ledgerTransaction{debit, row("c", "b", "CRDT", "SEB", "2026-09-22")}, 2, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			entries, err := projectBankEntries(accounts, test.rows)
			if err != nil || len(entries) != test.want {
				t.Fatalf("entries: %+v %v", entries, err)
			}
			if (entries[0].Kind == "transfer") != test.transfer {
				t.Fatalf("wrong matching: %+v", entries)
			}
			if test.transfer && (entries[0].ID != "d" || entries[0].DestinationID != "b") {
				t.Fatal("transfer lost stable debit identity")
			}
		})
	}
	// Contradicting IBAN evidence must not fall back to a friendly name.
	var tr banking.Transaction
	json.Unmarshal(debit.Payload, &tr)
	tr.CreditorAccount.IBAN = "LT999"
	debit.Payload, _ = json.Marshal(tr)
	result, _ := projectBankEntries(accounts, []ledgerTransaction{debit, credit})
	if len(result) != 2 {
		t.Fatal("ignored conflicting IBAN")
	}
	// Account identifiers work without names.
	tr.Creditor.Name = "Account owner"
	tr.CreditorAccount.IBAN = "lt 002"
	debit.Payload, _ = json.Marshal(tr)
	json.Unmarshal(credit.Payload, &tr)
	tr.Debtor.Name = "Account owner"
	tr.DebtorAccount.IBAN = "LT001"
	credit.Payload, _ = json.Marshal(tr)
	result, _ = projectBankEntries(accounts, []ledgerTransaction{credit, debit})
	if len(result) != 1 || result[0].Kind != "transfer" {
		t.Fatal("IBAN pair not recognized")
	}
}
