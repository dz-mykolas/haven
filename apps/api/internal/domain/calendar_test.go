package domain

import "testing"

func TestYearlyPaymentProjection(t *testing.T) {
	task := Task{ID: "annual", Title: "Annual subscription", Date: "2024-02-29", Repeat: "yearly", AnchorDay: 29, Kind: "payment", Amount: 1999}
	for _, want := range []string{"2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"} {
		var err error
		task, err = Complete(task)
		if err != nil || task.Date != want {
			t.Fatalf("annual anchor: %+v %v", task, err)
		}
	}
	task.Date = "2024-02-29"
	upcoming := Upcoming([]Task{task}, "2028-02-01")
	if len(upcoming.Items) != 1 || upcoming.Items[0].Date != "2028-02-29" || upcoming.Minimum != "1999" {
		t.Fatalf("annual upcoming projection: %+v", upcoming)
	}
}

func TestCalendarRecurrenceAndCompletion(t *testing.T) {
	monthly := Task{ID: "rent", Title: "Rent", Date: "2028-01-31", Repeat: "monthly", AnchorDay: 31, Timezone: "Europe/Vilnius"}
	daily := Task{ID: "daily", Title: "Vitamins", Date: "1900-01-01", Repeat: "daily", Timezone: "Europe/Vilnius"}
	weekly := Task{ID: "weekly", Date: "2028-01-03", Repeat: "weekly"}
	done := Task{ID: "done", Date: "2028-02-10", Repeat: "none", Done: true}
	items := Calendar([]Task{monthly, daily, weekly, done}, []Completion{{TaskID: "done", DueDate: "2028-02-10"}}, "2028-02")
	counts := map[string]int{}
	for _, item := range items.Items {
		counts[item.Task.ID]++
		if item.Task.ID == "rent" && item.Date != "2028-01-31" && item.Date != "2028-02-29" {
			t.Fatalf("monthly anchor lost: %+v", item)
		}
		if item.Task.ID == "daily" && !item.Projected {
			t.Fatal("old daily recurrence was not projected")
		}
	}
	if counts["rent"] != 2 || counts["daily"] != 42 || counts["weekly"] != 6 || counts["done"] != 1 {
		t.Fatalf("wrong occurrences: %+v", counts)
	}
	monthly.Date = "2028-03-31"
	march := Calendar([]Task{monthly}, []Completion{{TaskID: "rent", DueDate: "2028-02-29"}}, "2028-03")
	if len(march.Items) != 2 || !march.Items[0].Completed || march.Items[0].Date != "2028-02-29" || march.Items[1].Projected || march.Items[1].Date != "2028-03-31" {
		t.Fatalf("wrong completed/current occurrences: %+v", march)
	}
	if monthly.Date != "2028-03-31" {
		t.Fatal("calendar mutated the schedule")
	}
}
func TestCalendarYearBoundaryAndDeleted(t *testing.T) {
	task := Task{ID: "monthly", Date: "2026-01-31", Repeat: "monthly", AnchorDay: 31}
	result := Calendar([]Task{task, {ID: "deleted", Date: "2026-12-01", Deleted: true, Repeat: "daily"}}, []Completion{{TaskID: "deleted", DueDate: "2026-12-01"}}, "2026-12")
	if result.From != "2026-11-30" || result.To != "2027-01-10" || len(result.Items) != 2 || result.Items[0].Date != "2026-11-30" || result.Items[1].Date != "2026-12-31" {
		t.Fatalf("wrong year boundary: %+v", result)
	}
}

func TestCalendarDistantDailySchedule(t *testing.T) {
	result := Calendar([]Task{{ID: "old", Date: "1900-01-01", Repeat: "daily"}}, nil, "9998-02")
	if len(result.Items) != 42 {
		t.Fatalf("distant recurrence should project 42 days, got %d", len(result.Items))
	}
}
