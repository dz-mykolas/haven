package domain

import (
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Money crosses the API as integer minor-unit strings. This slice supports EUR only.
type Account struct {
	Source      string `json:"source,omitempty" db:"source"`
	BankBalance *int64 `json:"bank_balance_minor,string,omitempty" db:"bank_balance_minor"`
	ID          string `json:"id"`
	Name        string `json:"name"`
	Currency    string `json:"currency"`
	Opening     int64  `json:"opening_minor,string" db:"opening_minor"`
	Version     int64  `json:"version"`
}
type Category struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Hidden  bool   `json:"hidden"`
	Version int64  `json:"version"`
}
type Entry struct {
	PaymentUnits    int      `json:"payment_units,omitempty" db:"-"`
	Payment         *Task    `json:"payment,omitempty" db:"-"`
	CategoryID      string   `json:"category_id,omitempty" db:"category_id"`
	Tags            []string `json:"tags"`
	BankDescription string   `json:"bank_description,omitempty" db:"bank_description"`
	Source          string   `json:"source,omitempty" db:"source"`
	ID              string   `json:"id"`
	AccountID       string   `json:"account_id" db:"account_id"`
	DestinationID   string   `json:"destination_id" db:"destination_id"`
	Kind            string   `json:"kind"`
	Amount          int64    `json:"amount_minor,string" db:"amount_minor"`
	Date            string   `json:"date"`
	Payee           string   `json:"payee"`
	Category        string   `json:"category"`
	Notes           string   `json:"notes"`
	Deleted         bool     `json:"deleted"`
	Version         int64    `json:"version"`
}
type Task struct {
	FollowUp     *FollowUp    `json:"follow_up,omitempty" db:"-"`
	Plan         *PaymentPlan `json:"plan,omitempty" db:"plan"`
	EstimatedMin *int64       `json:"estimated_min_minor,string" db:"estimated_min_minor"`
	EstimatedMax *int64       `json:"estimated_max_minor,string" db:"estimated_max_minor"`
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Date         string       `json:"date"`
	Time         string       `json:"time"`
	Timezone     string       `json:"timezone"`
	Repeat       string       `json:"repeat"`
	AnchorDay    int          `json:"anchor_day" db:"anchor_day"`
	Kind         string       `json:"kind"`
	Amount       int64        `json:"amount_minor,string" db:"amount_minor"`
	Notes        string       `json:"notes"`
	// Tags group tasks; built-in tags (prefixed "@") also change behaviour.
	Tags []string `json:"tags"`
	// Every repeats the schedule every N days/weeks/months/years; Weekdays
	// (1 = Monday … 7 = Sunday) picks days for weekly repeats. A repeating
	// task ends after Until.
	Every    int    `json:"every"`
	Weekdays []int  `json:"weekdays"`
	Until    string `json:"until"`
	// Income marks the amount as money coming in rather than a cost.
	Income bool `json:"income"`
	// StartsOn is when the current schedule began. Server-owned.
	StartsOn      string `json:"starts_on,omitempty" db:"starts_on"`
	ContinuesFrom string `json:"continues_from,omitempty" db:"continues_from"`
	Done          bool   `json:"done"`
	Deleted       bool   `json:"deleted"`
	Version       int64  `json:"version"`
}

// FollowUp is the assistant's state for a task's notes. It is owned by the
// server: the summary is the assistant's own note of what it plans, CheckOn
// when it looks again, and Proposal a change waiting for the user's approval.
type FollowUp struct {
	Summary  string    `json:"summary"`
	CheckOn  string    `json:"check_on,omitempty"`
	Status   string    `json:"status"`
	Error    string    `json:"error,omitempty"`
	Proposal *Proposal `json:"proposal,omitempty"`
}
type Proposal struct {
	EventID string `json:"event_id"`
	Message string `json:"message"`
}
type Completion struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id" db:"task_id"`
	DueDate     string    `json:"due_date" db:"due_date"`
	CompletedAt time.Time `json:"completed_at" db:"completed_at"`
}
type Snapshot struct {
	Upcoming   *UpcomingCosts    `json:"upcoming,omitempty"`
	Categories []Category        `json:"categories"`
	Tags       []string          `json:"tags"`
	Accounts   []Account         `json:"accounts"`
	Entries    []Entry           `json:"entries"`
	Tasks      []Task            `json:"tasks"`
	Balances   map[string]string `json:"balances"`
	Total      string            `json:"total_minor"`
	Income     string            `json:"income_minor"`
	Spending   string            `json:"spending_minor"`
	Month      string            `json:"month"`
}

var uuid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var month = regexp.MustCompile(`^\d{4}-\d{2}$`)

const MaxAmount int64 = 9_000_000_000_000

func ValidID(id string) bool { return uuid.MatchString(id) && id == strings.ToLower(id) }
func ValidMonth(s string) bool {
	_, err := time.Parse("2006-01", s)
	return month.MatchString(s) && err == nil
}
func ValidDate(s string) bool {
	d, err := time.Parse("2006-01-02", s)
	return err == nil && d.Year() >= 1900 && d.Year() <= 9998 && d.Format("2006-01-02") == s
}
func (a Account) Validate() error {
	if !ValidID(a.ID) || strings.TrimSpace(a.Name) == "" || len(a.Name) > 100 || a.Currency != "EUR" || a.Opening < -MaxAmount || a.Opening > MaxAmount {
		return errors.New("Use a name, EUR, and an opening balance within the supported range")
	}
	return nil
}
func (e Entry) Validate() error {
	if !ValidID(e.ID) || !ValidID(e.AccountID) || !ValidDate(e.Date) || e.Amount <= 0 || e.Amount > MaxAmount {
		return errors.New("Choose an account, a valid date, and a positive amount")
	}
	if len(e.Payee) > 200 || len(e.Category) > 100 || utf8.RuneCountInString(e.Notes) > 4000 {
		return errors.New("Payee, category, or notes are too long")
	}
	if e.Kind == "transfer" {
		if !ValidID(e.DestinationID) || e.AccountID == e.DestinationID {
			return errors.New("Choose a different destination account")
		}
	} else if (e.Kind != "income" && e.Kind != "expense") || e.DestinationID != "" {
		return errors.New("Choose income, expense, or transfer")
	}
	return nil
}
func (t Task) Validate() error {
	if err := t.ValidatePlan(); err != nil {
		return err
	}
	if (t.EstimatedMin == nil) != (t.EstimatedMax == nil) || (t.EstimatedMin != nil && (*t.EstimatedMin < 0 || *t.EstimatedMax < *t.EstimatedMin || *t.EstimatedMax > MaxAmount)) {
		return errors.New("Use a non-negative estimated cost or an ascending range")
	}
	if !ValidID(t.ID) || strings.TrimSpace(t.Title) == "" || len(t.Title) > 200 || (!ValidDate(t.Date) && !(t.Forecast() && t.Date == "")) || len(t.Notes) > 4000 {
		return errors.New("Use a title and a valid date")
	}
	if t.Time != "" {
		parsed, err := time.Parse("15:04", t.Time)
		if err != nil || parsed.Format("15:04") != t.Time {
			return errors.New("Use a valid time")
		}
	}
	if t.Timezone == "" || t.Timezone == "Local" {
		return errors.New("Choose a valid IANA timezone")
	}
	if _, err := time.LoadLocation(t.Timezone); err != nil {
		return errors.New("Choose a valid IANA timezone")
	}
	if t.Repeat != "none" && t.Repeat != "daily" && t.Repeat != "weekly" && t.Repeat != "monthly" && t.Repeat != "yearly" {
		return errors.New("Unsupported repeat schedule")
	}
	if t.Kind != "task" && t.Kind != "appointment" && t.Kind != "payment" {
		return errors.New("Unsupported task type")
	}
	if err := t.validateSchedule(); err != nil {
		return err
	}
	if t.Amount < 0 || t.Amount > MaxAmount || (t.Kind != "payment" && t.Amount != 0) {
		return errors.New("Only payment reminders can have an amount")
	}
	return nil
}

func Summarize(accounts []Account, entries []Entry, tasks []Task, reportingMonth string) Snapshot {
	s := Snapshot{Accounts: accounts, Entries: entries, Tasks: tasks, Balances: map[string]string{}, Month: reportingMonth}
	balances := map[string]*big.Int{}
	bankBalances := map[string]bool{}
	total, income, spending := new(big.Int), new(big.Int), new(big.Int)
	for _, a := range accounts {
		balances[a.ID] = big.NewInt(a.Opening)
		if a.BankBalance != nil {
			balances[a.ID] = big.NewInt(*a.BankBalance)
			bankBalances[a.ID] = true
		}
	}
	for _, e := range entries {
		if e.Deleted {
			continue
		}
		amount := big.NewInt(e.Amount)
		if b := balances[e.AccountID]; b != nil && !bankBalances[e.AccountID] {
			if e.Kind == "income" {
				b.Add(b, amount)
			} else {
				b.Sub(b, amount)
			}
		}
		if e.Kind == "transfer" {
			if b := balances[e.DestinationID]; b != nil && !bankBalances[e.DestinationID] {
				b.Add(b, amount)
			}
		}
		if strings.HasPrefix(e.Date, reportingMonth+"-") {
			if e.Kind == "income" {
				income.Add(income, amount)
			}
			if e.Kind == "expense" {
				spending.Add(spending, amount)
			}
		}
	}
	for id, b := range balances {
		s.Balances[id] = b.String()
		total.Add(total, b)
	}
	s.Total = total.String()
	s.Income = income.String()
	s.Spending = spending.String()
	return s
}
func Conflict(version int64) error {
	return fmt.Errorf("This record changed. Refresh and try again (current version %d)", version)
}
