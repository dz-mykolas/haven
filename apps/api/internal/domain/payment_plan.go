package domain

import (
	"errors"
	"time"
)

// A forecast is not a calendar obligation. Prepaid coverage and the intention
// to buy again are independent of the transactions that paid for that coverage.
type PaymentPlan struct {
	ReminderCompletedOn string `json:"reminder_completed_on,omitempty"`
	Kind                string `json:"kind"`
	Excluded            bool   `json:"excluded"`
	Remind              bool   `json:"remind"`
	CoverageThrough     string `json:"coverage_through"`
	ExpiresOn           string `json:"expires_on"`
	DateUntil           string `json:"date_until"`
	IntervalDays        int    `json:"interval_days"`
	CoverageDays        int    `json:"coverage_days"`
	Quantity            int    `json:"quantity"`
}

func (t Task) Forecast() bool        { return t.Plan != nil && t.Plan.Kind != "scheduled" }
func (t Task) Included() bool        { return t.Plan == nil || !t.Plan.Excluded }
func (t Task) CalendarVisible() bool { return !t.Forecast() || t.Plan.Remind }
func (t Task) ValidatePlan() error {
	p := t.Plan
	if p == nil {
		return nil
	}
	if p.Kind != "scheduled" && p.Kind != "expected" && p.Kind != "prepaid" {
		return errors.New("Choose scheduled, expected or prepaid")
	}
	if p.CoverageDays < 0 || p.CoverageDays > 3660 || p.IntervalDays < 0 || p.IntervalDays > 3660 || p.Quantity < 1 || p.Quantity > 100 {
		return errors.New("Use a positive quantity and a duration up to 3,660 days")
	}
	if (p.CoverageThrough != "" && !ValidDate(p.CoverageThrough)) || (p.ReminderCompletedOn != "" && !ValidDate(p.ReminderCompletedOn)) {
		return errors.New("Choose a valid coverage baseline date")
	}
	if p.ExpiresOn != "" && !ValidDate(p.ExpiresOn) || p.DateUntil != "" && (!ValidDate(p.DateUntil) || t.Date == "" || p.DateUntil < t.Date) {
		return errors.New("Choose valid coverage and forecast dates")
	}
	if t.Forecast() && (t.Kind != "payment" || t.Repeat != "none") {
		return errors.New("Expected purchases use a forecast, not a fixed repeat schedule")
	}
	return nil
}

// Record only a confirmed product match. Incomplete coverage stays unknown;
// history is never used to invent a starting balance of prepaid days.
func Purchased(t Task, date string, units int) (Task, error) {
	if !t.Forecast() || !ValidDate(date) || units < 1 || units > 100 {
		return t, errors.New("Confirm the purchase date and quantity")
	}
	p := *t.Plan
	t.Plan = &p
	if p.Kind == "prepaid" && p.CoverageThrough != "" && date <= p.CoverageThrough {
		return t, nil
	}
	previousUntil := p.DateUntil
	p.DateUntil = ""
	if p.Kind == "prepaid" {
		if p.CoverageDays == 0 || p.ExpiresOn == "" {
			p.ExpiresOn = ""
			t.Date = ""
			return t, nil
		}
		anchor := p.ExpiresOn
		if date > anchor {
			anchor = date
		}
		start, _ := time.Parse("2006-01-02", anchor)
		p.ExpiresOn = start.AddDate(0, 0, p.CoverageDays*units).Format("2006-01-02")
		t.Date = p.ExpiresOn
	} else if p.IntervalDays > 0 {
		start, _ := time.Parse("2006-01-02", date)
		spread := 0
		if t.Date != "" && previousUntil != "" {
			a, _ := time.Parse("2006-01-02", t.Date)
			b, _ := time.Parse("2006-01-02", previousUntil)
			spread = int(b.Sub(a).Hours() / 24)
		}
		earliest := p.IntervalDays - spread/2
		if earliest < 1 {
			earliest = 1
		}
		next := start.AddDate(0, 0, earliest).Format("2006-01-02")
		if next > t.Date {
			t.Date = next
			if spread > 0 {
				p.DateUntil = start.AddDate(0, 0, earliest+spread).Format("2006-01-02")
			}
		} else {
			p.DateUntil = previousUntil
		}
	} else {
		t.Date = ""
	}
	if err := t.Validate(); err != nil {
		return t, err
	}
	return t, nil
}
