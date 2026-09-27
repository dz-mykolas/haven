package domain

import "testing"

func TestExactMoneyAndTransfers(t *testing.T) {
	a := []Account{{ID: "a", Opening: 10000}, {ID: "b", Opening: 2000}}
	e := []Entry{{AccountID: "a", Kind: "expense", Amount: 10, Date: "2026-09-01"}, {AccountID: "a", Kind: "expense", Amount: 20, Date: "2026-09-01"}, {AccountID: "a", DestinationID: "b", Kind: "transfer", Amount: 1000, Date: "2026-09-01"}, {AccountID: "b", Kind: "income", Amount: 500, Date: "2026-09-01"}, {AccountID: "b", Kind: "expense", Amount: 9999, Date: "2026-09-01", Deleted: true}, {AccountID: "b", Kind: "income", Amount: 100, Date: "2026-08-01"}}
	s := Summarize(a, e, nil, "2026-09")
	if s.Total != "12570" || s.Income != "500" || s.Spending != "30" || s.Balances["a"] != "8970" || s.Balances["b"] != "3600" {
		t.Fatalf("wrong totals: %+v", s)
	}
	e[0].Deleted = true
	s = Summarize(a, e, nil, "2026-09")
	if s.Total != "12580" || s.Spending != "20" {
		t.Fatal("deleting an expense should reverse its effect")
	}
}
func TestMonthlyAnchorAndCalendarRecurrence(t *testing.T) {
	for _, tc := range []struct {
		date, repeat, want string
		anchor             int
	}{{"2026-01-31", "monthly", "2026-02-28", 31}, {"2026-02-28", "monthly", "2026-03-31", 31}, {"2028-01-31", "monthly", "2028-02-29", 31}, {"2026-03-28", "daily", "2026-03-29", 28}, {"2026-10-24", "weekly", "2026-10-31", 24}} {
		t.Run(tc.date+tc.repeat, func(t *testing.T) {
			task := Task{Date: tc.date, Repeat: tc.repeat, AnchorDay: tc.anchor, Timezone: "Europe/Vilnius", Time: "09:00"}
			next, err := Complete(task)
			if err != nil || next.Date != tc.want || next.Time != "09:00" || next.Timezone != "Europe/Vilnius" {
				t.Fatalf("got %+v, %v", next, err)
			}
		})
	}
	once, err := Complete(Task{Repeat: "none"})
	if err != nil || !once.Done {
		t.Fatal("one-off completion failed")
	}
	if _, err = Complete(once); err == nil {
		t.Fatal("must reject double completion")
	}
}
func TestValidation(t *testing.T) {
	base := Task{ID: "00000000-0000-4000-8000-000000000001", Title: "Vitamins", Date: "2026-09-21", Timezone: "Europe/Vilnius", Repeat: "daily", Kind: "task"}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Task){func(t *Task) { t.Date = "2026-02-30" }, func(t *Task) { t.Timezone = "Local" }, func(t *Task) { t.Timezone = "Mars/Olympus" }, func(t *Task) { t.Amount = 100 }, func(t *Task) { t.Time = "25:00" }, func(t *Task) { t.Repeat = "sometimes" }} {
		task := base
		change(&task)
		if task.Validate() == nil {
			t.Fatalf("accepted invalid task %+v", task)
		}
	}
	if ValidDate("0000-01-01") || ValidMonth("2026-13") {
		t.Fatal("invalid calendar value accepted")
	}
}
