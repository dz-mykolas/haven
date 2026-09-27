package domain

import "testing"

func TestUpcomingCosts(t *testing.T) {
	lo, hi := int64(6000), int64(7000)
	tasks := []Task{
		{ID: "subscription", Title: "Netflix", Date: "2027-01-31", AnchorDay: 31, Repeat: "monthly", Kind: "payment", Amount: 1399},
		{ID: "appointment", Title: "Dentist", Date: "2027-02-01", Repeat: "none", Kind: "appointment", EstimatedMin: &lo, EstimatedMax: &hi},
		{ID: "unknown", Title: "Bill", Date: "2027-02-04", Repeat: "none", Kind: "payment"},
		{ID: "done", Date: "2027-02-04", Repeat: "none", Kind: "payment", Amount: 99999, Done: true},
		{ID: "deleted", Date: "2027-02-04", Repeat: "none", Kind: "payment", Amount: 99999, Deleted: true},
		{ID: "outside", Date: "2027-03-01", Repeat: "none", Kind: "payment", Amount: 99999},
		{ID: "past", Date: "2027-01-29", Repeat: "none", Kind: "payment", Amount: 99999},
		{ID: "free-task", Date: "2027-02-04", Repeat: "none", Kind: "task"},
	}
	got := Upcoming(tasks, "2027-01-30")
	if got.From != "2027-01-30" || got.To != "2027-02-28" || len(got.Items) != 4 || got.Unknown != 1 || got.Minimum != "8798" || got.Maximum != "9798" {
		t.Fatalf("wrong 30-day projection: %+v", got)
	}
	if got.Items[0].Date != "2027-01-31" || got.Items[3].Date != "2027-02-28" {
		t.Fatalf("lost monthly anchor: %+v", got.Items)
	}
	completed, err := Complete(tasks[0])
	if err != nil {
		t.Fatal(err)
	}
	tasks[0] = completed
	got = Upcoming(tasks, "2027-01-30")
	if got.Minimum != "7399" || got.Maximum != "8399" {
		t.Fatalf("completed occurrence still counted: %+v", got)
	}
	if tasks[1].EstimatedMin == nil || *tasks[1].EstimatedMin != 6000 {
		t.Fatal("projection mutated task")
	}
	zero := int64(0)
	tasks = []Task{{ID: "known-free", Date: "2027-01-30", Repeat: "none", Kind: "appointment", EstimatedMin: &zero, EstimatedMax: &zero}}
	got = Upcoming(tasks, "2027-01-30")
	if len(got.Items) != 1 || got.Unknown != 0 {
		t.Fatal("explicit zero treated as unknown")
	}
}
func TestEstimatedCostValidation(t *testing.T) {
	low, high := int64(6000), int64(7000)
	task := Task{ID: "71000000-0000-4000-8000-000000000001", Title: "Dentist", Date: "2026-10-03", Timezone: "Europe/Vilnius", Kind: "appointment", Repeat: "none", EstimatedMin: &low, EstimatedMax: &high}
	if err := task.Validate(); err != nil {
		t.Fatal(err)
	}
	task.EstimatedMax = nil
	if task.Validate() == nil {
		t.Fatal("accepted half a range")
	}
	task.EstimatedMax = &high
	high = 5000
	if task.Validate() == nil {
		t.Fatal("accepted reversed range")
	}
	high = 7000
	low = -1
	if task.Validate() == nil {
		t.Fatal("accepted negative estimate")
	}
	low = 0
	high = MaxAmount + 1
	if task.Validate() == nil {
		t.Fatal("accepted out of bounds estimate")
	}
}

func TestUpcomingIncomeIsSeparateFromCosts(t *testing.T) {
	amount := int64(15000)
	rent := int64(75000)
	tasks := []Task{
		{ID: "a", Title: "Sell table", Date: "2027-01-05", Timezone: "UTC", Repeat: "none", Kind: "task", EstimatedMin: &amount, EstimatedMax: &amount, Income: true},
		{ID: "b", Title: "Rent", Date: "2027-01-10", Timezone: "UTC", Repeat: "none", Kind: "payment", Amount: rent},
	}
	up := Upcoming(tasks, "2027-01-01")
	if up.Income.Minimum != "15000" || up.Minimum != "75000" || up.Maximum != "75000" {
		t.Fatalf("income %+v, costs %s–%s", up.Income, up.Minimum, up.Maximum)
	}
}
