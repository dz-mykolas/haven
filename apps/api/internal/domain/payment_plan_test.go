package domain

import "testing"

func forecastTask() Task {
	return Task{ID: "81000000-0000-4000-8000-000000000001", Title: "Welkin", Date: "2026-10-01", Timezone: "UTC", Kind: "payment", Repeat: "none", Amount: 499, Plan: &PaymentPlan{Kind: "prepaid", Quantity: 1, CoverageDays: 30, ExpiresOn: "2026-10-01", CoverageThrough: "2026-09-01"}}
}
func TestPrepaidCoverage(t *testing.T) {
	original := forecastTask()
	got, err := Purchased(original, "2026-09-24", 4)
	if err != nil || got.Plan.ExpiresOn != "2027-01-29" || got.Date != got.Plan.ExpiresOn {
		t.Fatalf("stacked coverage: %+v %v", got, err)
	}
	if original.Plan.ExpiresOn != "2026-10-01" {
		t.Fatal("mutated baseline")
	}
	past, err := Purchased(original, "2026-08-01", 4)
	if err != nil || past.Plan.ExpiresOn != original.Plan.ExpiresOn {
		t.Fatal("backfill counted coverage twice")
	}
	got, err = Purchased(original, "2026-11-01", 1)
	if err != nil || got.Plan.ExpiresOn != "2026-12-01" {
		t.Fatal("expired coverage didn't start at purchase date")
	}
	original.Plan.ExpiresOn = ""
	got, err = Purchased(original, "2026-09-24", 1)
	if err != nil || got.Date != "" || got.Plan.ExpiresOn != "" {
		t.Fatal("invented expiry from missing baseline")
	}
	if _, err = Purchased(original, "2026-09-24", 0); err == nil {
		t.Fatal("accepted unknown quantity")
	}
}
func TestForecastProjection(t *testing.T) {
	prepaid := forecastTask()
	scheduled := Task{ID: "bill", Title: "Rent", Date: "2026-10-01", Kind: "payment", Repeat: "monthly", Amount: 75000}
	expected := forecastTask()
	expected.ID = "battlepass"
	expected.Amount = 999
	expected.Date = "2026-09-20"
	expected.Plan = &PaymentPlan{Kind: "expected", Quantity: 1, DateUntil: "2026-10-15", IntervalDays: 40}
	unknown := forecastTask()
	unknown.ID = "unknown"
	unknown.Date = ""
	unknown.Plan = &PaymentPlan{Kind: "prepaid", Quantity: 1}
	tasks := []Task{prepaid, scheduled, expected, unknown}
	got := Upcoming(tasks, "2026-09-24")
	if got.Minimum != "76498" || got.Scheduled.Minimum != "75000" || got.Expected.Minimum != "1498" || got.Unknown != 1 || len(got.Items) != 4 {
		t.Fatalf("forecast totals: %+v", got)
	}
	prepaid.Plan.Excluded = true
	tasks[0] = prepaid
	got = Upcoming(tasks, "2026-09-24")
	if got.Minimum != "75999" || len(got.Items) != 4 {
		t.Fatal("exclusion hid coverage or kept cost")
	}
	if len(Calendar([]Task{expected, unknown}, nil, "2026-10").Items) != 0 {
		t.Fatal("forecast became an unrequested task")
	}
	expected.Plan.Remind = true
	expected.Date = "2026-10-01"
	if len(Calendar([]Task{expected}, nil, "2026-10").Items) != 1 {
		t.Fatal("opt-in reminder missing")
	}
	prepaid.Plan.Excluded = false
	prepaid.Date = "2026-11-01"
	got = Upcoming([]Task{prepaid}, "2026-09-24")
	if len(got.Items) != 1 || got.Items[0].Date != "2026-10-01" || got.Items[0].Event != "expiry" || got.Minimum != "0" {
		t.Fatalf("charged outside-window purchase on expiry: %+v", got)
	}
	prepaid.Date = "2026-09-28"
	got = Upcoming([]Task{prepaid}, "2026-09-24")
	if got.Items[0].Event != "payment" || got.Minimum != "499" {
		t.Fatal("early purchase mislabeled as expiry")
	}
}

func TestIrregularPurchaseRetainsUncertainty(t *testing.T) {
	task := forecastTask()
	task.Plan = &PaymentPlan{Kind: "expected", Quantity: 1, IntervalDays: 40, DateUntil: "2026-10-31"}
	task.Date = "2026-09-21"
	got, err := Purchased(task, "2026-10-01", 1)
	if err != nil || got.Date != "2026-10-21" || got.Plan.DateUntil != "2026-11-30" {
		t.Fatalf("lost estimated window: %+v %v", got, err)
	}
	old, err := Purchased(got, "2026-08-01", 1)
	if err != nil || old.Date != got.Date || old.Plan.DateUntil != got.Plan.DateUntil {
		t.Fatal("backfill rewound expected purchase")
	}
}

func TestCompletingForecastReminderKeepsRenewal(t *testing.T) {
	task := forecastTask()
	task.Plan.Remind = true
	done, err := Complete(task)
	if err != nil || done.Done || done.Plan.ReminderCompletedOn != task.Date {
		t.Fatalf("reminder archived renewal: %+v %v", done, err)
	}
	if Upcoming([]Task{done}, "2026-09-24").Minimum != "499" {
		t.Fatal("reminder completion removed forecast cost")
	}
	if _, err = Complete(done); err == nil {
		t.Fatal("completed reminder twice")
	}
	renewed, err := Purchased(done, "2026-10-01", 1)
	if err != nil || renewed.Date == renewed.Plan.ReminderCompletedOn {
		t.Fatal("new coverage has no new reminder")
	}
}
