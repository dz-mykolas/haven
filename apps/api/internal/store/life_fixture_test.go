package store

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

func TestSixMonthFixtureReconciles(t *testing.T) {
	var fixture struct {
		Accounts []struct {
			Info         banking.Account       `json:"info"`
			Balances     []banking.Balance     `json:"balances"`
			Transactions []banking.Transaction `json:"transactions"`
		} `json:"accounts"`
	}
	var manifest struct {
		Total    int   `json:"total_booked_records"`
		Count    int   `json:"money_transactions"`
		Closing  int64 `json:"total_closing_minor"`
		Accounts []struct {
			Opening int64 `json:"opening_minor"`
			Closing int64 `json:"closing_minor"`
		}
		Months []struct {
			Month    string
			Income   int64 `json:"income_minor"`
			Spending int64 `json:"spending_minor"`
		}
	}
	read := func(file string, v any) {
		t.Helper()
		b, err := os.ReadFile("../../../../" + file)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(b, v); err != nil {
			t.Fatal(err)
		}
	}
	read("fixtures/enable-banking/seb.json", &fixture)
	seb := fixture.Accounts
	fixture.Accounts = nil
	read("fixtures/enable-banking/revolut.json", &fixture)
	if len(seb) != 1 || len(fixture.Accounts) != 1 {
		t.Fatal("each upload file must contain exactly one account")
	}
	fixture.Accounts = append(seb, fixture.Accounts...)
	read("tests/fixtures/enable-banking/scenario.json", &manifest)
	if len(fixture.Accounts) != 2 || len(manifest.Months) != 7 || manifest.Total < 300 {
		t.Fatal("scenario is not two accounts over six full months")
	}
	accounts := []ledgerAccount{}
	rows := []ledgerTransaction{}
	domainAccounts := []domain.Account{}
	seen := map[string]bool{}
	for i, a := range fixture.Accounts {
		balance, err := bookedBalance(a.Balances)
		if err != nil {
			t.Fatal(err)
		}
		id := a.Info.Details
		accounts = append(accounts, ledgerAccount{ID: id, Name: id, App: "fixture", Balance: balance})
		domainAccounts = append(domainAccounts, domain.Account{ID: id, Currency: "EUR", BankBalance: &balance, Source: bankSource})
		running := manifest.Accounts[i].Opening
		for _, tr := range a.Transactions {
			amount, err := validateBooked(tr)
			if err != nil {
				t.Fatal(err)
			}
			if tr.Status != "BOOK" || seen[tr.Reference] {
				t.Fatal("pending or duplicate record in base fixture")
			}
			seen[tr.Reference] = true
			if tr.Direction == "DBIT" {
				running -= amount
			} else {
				running += amount
			}
			if running < 0 {
				t.Fatal("unplanned overdraft")
			}
			raw, _ := json.Marshal(tr)
			rows = append(rows, ledgerTransaction{ID: tr.Reference, AccountID: id, Payload: raw, Version: 1})
		}
		if running != balance || running != manifest.Accounts[i].Closing {
			t.Fatal("account balance does not reconcile")
		}
	}
	entries, err := projectBankEntries(accounts, rows)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != manifest.Total || len(entries) != manifest.Count {
		t.Fatal("transfer projection count is wrong")
	}
	for _, m := range manifest.Months {
		s := domain.Summarize(domainAccounts, entries, nil, m.Month)
		var actual struct {
			Total    int64 `json:"total_minor,string"`
			Income   int64 `json:"income_minor,string"`
			Spending int64 `json:"spending_minor,string"`
		}
		encoded, _ := json.Marshal(s)
		json.Unmarshal(encoded, &actual)
		if actual.Total != manifest.Closing || actual.Income != m.Income || actual.Spending != m.Spending {
			t.Fatalf("month %s: %+v", m.Month, actual)
		}
	}
}
