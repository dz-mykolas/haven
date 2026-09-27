package domain

import (
	"slices"
	"testing"
	"time"
)

func steps(t *testing.T, task Task, n int) []string {
	t.Helper()
	out := []string{task.Date}
	for i := 1; i < n; i++ {
		next, err := Complete(task)
		if err != nil {
			t.Fatal(err)
		}
		if next.Done {
			out = append(out, "done")
			break
		}
		task = next
		out = append(out, task.Date)
	}
	return out
}

func TestSchedules(t *testing.T) {
	base := Task{ID: "10000000-0000-4000-8000-000000000001", Title: "x", Timezone: "UTC", Kind: "task"}
	cases := []struct {
		name string
		task func(Task) Task
		want []string
	}{
		{"every 10 days", func(t Task) Task { t.Date, t.Repeat, t.Every = "2027-01-01", "daily", 10; return t }, []string{"2027-01-01", "2027-01-11", "2027-01-21"}},
		{"weekly on Mon and Thu", func(t Task) Task { t.Date, t.Repeat, t.Weekdays = "2027-01-04", "weekly", []int{1, 4}; return t }, []string{"2027-01-04", "2027-01-07", "2027-01-11", "2027-01-14"}},
		{"every 2 weeks on Mon and Thu", func(t Task) Task {
			t.Date, t.Repeat, t.Every, t.Weekdays = "2027-01-04", "weekly", 2, []int{1, 4}
			return t
		}, []string{"2027-01-04", "2027-01-07", "2027-01-18", "2027-01-21"}},
		{"every 2 months keeps the 31st", func(t Task) Task { t.Date, t.Repeat, t.Every, t.AnchorDay = "2027-01-31", "monthly", 2, 31; return t }, []string{"2027-01-31", "2027-03-31", "2027-05-31"}},
		{"until ends the schedule", func(t Task) Task { t.Date, t.Repeat, t.Until = "2027-01-01", "daily", "2027-01-02"; return t }, []string{"2027-01-01", "2027-01-02", "done"}},
	}
	for _, c := range cases {
		task := c.task(base).Normalize()
		if err := task.Validate(); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got := steps(t, task, len(c.want)); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
	// Chosen weekdays move the start to the first chosen day.
	task := base
	task.Date, task.Repeat, task.Weekdays = "2027-01-05", "weekly", []int{4, 1, 4}
	task = task.Normalize()
	if task.Date != "2027-01-07" || !slices.Equal(task.Weekdays, []int{1, 4}) {
		t.Fatalf("weekday normalization: %s %v", task.Date, task.Weekdays)
	}
	// The calendar projects the same schedule.
	cal := Calendar([]Task{task}, nil, "2027-01")
	dates := []string{}
	for _, item := range cal.Items {
		dates = append(dates, item.Date)
	}
	if !slices.Contains(dates, "2027-01-11") || slices.Contains(dates, "2027-01-12") || !slices.Contains(dates, "2027-01-14") {
		t.Fatalf("calendar weekdays: %v", dates)
	}
}

func TestTagsAndSkippingMissedDays(t *testing.T) {
	task := Task{Kind: "task", Repeat: "daily", Tags: []string{" #Health", "health", SkipMissed, ""}}.Normalize()
	if !slices.Equal(task.Tags, []string{SkipMissed, "Health"}) || !task.SkipsMissed() {
		t.Fatalf("tags: %v", task.Tags)
	}
	payment := Task{Kind: "payment", Repeat: "monthly", Tags: []string{SkipMissed, "Home"}}.Normalize()
	if slices.Contains(payment.Tags, SkipMissed) || payment.SkipsMissed() {
		t.Fatal("payments never skip missed occurrences")
	}
	if !(Task{Kind: "appointment", Repeat: "weekly"}).SkipsMissed() || (Task{Kind: "appointment", Repeat: "none"}).SkipsMissed() {
		t.Fatal("repeating appointments always skip missed occurrences")
	}
	if (Task{ID: "10000000-0000-4000-8000-000000000001", Title: "x", Date: "2027-01-01", Timezone: "UTC", Repeat: "daily", Kind: "task", Tags: []string{"@unknown"}}).Validate() == nil {
		t.Fatal("unknown built-in tag accepted")
	}
	now := time.Date(2027, 1, 10, 12, 0, 0, 0, time.UTC)
	vitamins := Task{Kind: "task", Timezone: "UTC", Date: "2027-01-05", Repeat: "daily", Tags: []string{SkipMissed}}
	if got := CatchUp(vitamins, now); got.Date != "2027-01-10" {
		t.Fatalf("missed days should lapse: %s", got.Date)
	}
	vitamins.Until = "2027-01-08"
	if got := CatchUp(vitamins, now); !got.Done {
		t.Fatal("a lapsed schedule past its end date should end")
	}
	chore := Task{Kind: "task", Timezone: "UTC", Date: "2027-01-05", Repeat: "daily"}
	if CatchUp(chore, now).Date != "2027-01-05" {
		t.Fatal("ordinary tasks stay overdue")
	}
	vitamins = Task{Kind: "task", Timezone: "UTC", Date: "2027-01-10", StartsOn: "2027-01-01", Repeat: "daily", Every: 3}
	if got := Occurrences(vitamins, "2027-01-10", 2); !slices.Equal(got, []string{"2027-01-07", "2027-01-10"}) {
		t.Fatalf("occurrences: %v", got)
	}
}
