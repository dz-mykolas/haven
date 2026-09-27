package domain

import (
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

// SkipMissed is the built-in tag that lets a task's missed occurrences lapse.
// Built-in tags are stored by ID so their display names can change.
const SkipMissed = "@skip-missed"

var builtInTags = []string{SkipMissed}

// SkipsMissed reports whether missed occurrences lapse instead of staying
// overdue: tasks opt in with the tag, repeating appointments always do, and
// payments never do because a missed bill still has to be paid.
func (t Task) SkipsMissed() bool {
	if t.Repeat == "none" || t.Forecast() {
		return false
	}
	return t.Kind == "appointment" || (t.Kind == "task" && slices.Contains(t.Tags, SkipMissed))
}

func isoWeekday(d time.Time) int { return (int(d.Weekday())+6)%7 + 1 }

// Normalize applies defaults and canonical forms before validation.
func (t Task) Normalize() Task {
	if t.Every <= 0 {
		t.Every = 1
	}
	tags, seen := []string{}, map[string]bool{}
	for _, tag := range t.Tags {
		tag = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
		key := strings.ToLower(tag)
		if tag == "" || seen[key] || (tag == SkipMissed && t.Kind != "task") {
			continue
		}
		seen[key] = true
		tags = append(tags, tag)
	}
	// Built-in tags always come first.
	slices.SortStableFunc(tags, func(a, b string) int {
		ab, bb := strings.HasPrefix(a, "@"), strings.HasPrefix(b, "@")
		if ab == bb {
			return 0
		}
		if ab {
			return -1
		}
		return 1
	})
	t.Tags = tags
	if t.Repeat == "none" || t.Forecast() {
		t.Every, t.Weekdays, t.Until = 1, []int{}, ""
		return t
	}
	days := []int{}
	for _, d := range t.Weekdays {
		if d >= 1 && d <= 7 && !slices.Contains(days, d) {
			days = append(days, d)
		}
	}
	slices.Sort(days)
	if t.Repeat != "weekly" {
		days = []int{}
	}
	t.Weekdays = days
	// A weekly task on chosen days starts on the first chosen day.
	if d, err := time.Parse("2006-01-02", t.Date); err == nil && len(days) > 0 && !slices.Contains(days, isoWeekday(d)) {
		for !slices.Contains(days, isoWeekday(d)) {
			d = d.AddDate(0, 0, 1)
		}
		t.Date = d.Format("2006-01-02")
	}
	return t
}

func (t Task) validateSchedule() error {
	if len(t.Tags) > 12 {
		return errors.New("Use up to 12 tags")
	}
	for _, tag := range t.Tags {
		if strings.HasPrefix(tag, "@") && !slices.Contains(builtInTags, tag) {
			return errors.New("Unknown built-in tag")
		}
		if tag == SkipMissed && t.Kind != "task" {
			return errors.New("Only tasks can skip missed days")
		}
		if strings.TrimSpace(tag) == "" || utf8.RuneCountInString(tag) > 40 {
			return errors.New("Tags must be 1–40 characters")
		}
	}
	if t.Every < 0 || t.Every > 365 {
		return errors.New("Repeat every 1 to 365 days, weeks, months or years")
	}
	for _, d := range t.Weekdays {
		if d < 1 || d > 7 || t.Repeat != "weekly" {
			return errors.New("Weekdays apply only to weekly repeats")
		}
	}
	if t.Until != "" && (t.Repeat == "none" || !ValidDate(t.Until) || t.Until < t.Date) {
		return errors.New("The end date must be on or after the task date")
	}
	return nil
}

// nextDate is the occurrence after d for a repeating task.
func nextDate(t Task, d time.Time) (time.Time, error) {
	n := max(t.Every, 1)
	switch t.Repeat {
	case "daily":
		return d.AddDate(0, 0, n), nil
	case "weekly":
		if len(t.Weekdays) == 0 {
			return d.AddDate(0, 0, 7*n), nil
		}
		wd := isoWeekday(d)
		for _, w := range t.Weekdays {
			if w > wd {
				return d.AddDate(0, 0, w-wd), nil
			}
		}
		monday := d.AddDate(0, 0, 1-wd)
		return monday.AddDate(0, 0, 7*n+t.Weekdays[0]-1), nil
	case "monthly", "yearly":
		months := n
		if t.Repeat == "yearly" {
			months = 12 * n
		}
		first := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, months, 0)
		day := t.AnchorDay
		if day == 0 {
			day = d.Day()
		}
		return first.AddDate(0, 0, min(day, first.AddDate(0, 1, -1).Day())-1), nil
	}
	return d, errors.New("Unsupported repeat schedule")
}

// Complete advances exactly one scheduled occurrence, preserving the original
// monthly day. A repeating task past its end date is done. Dates and wall-clock
// time remain in the task's own timezone, including across DST.
func Complete(t Task) (Task, error) {
	if t.Done || t.Deleted {
		return t, errors.New("This task is already completed or deleted")
	}
	if t.Forecast() {
		if t.Date == "" || !t.Plan.Remind || t.Plan.ReminderCompletedOn == t.Date {
			return t, errors.New("This forecast has no pending reminder")
		}
		p := *t.Plan
		p.ReminderCompletedOn = t.Date
		t.Plan = &p
		return t, nil
	}
	if t.Repeat == "none" {
		t.Done = true
		return t, nil
	}
	d, err := time.Parse("2006-01-02", t.Date)
	if err != nil {
		return t, err
	}
	next, err := nextDate(t, d)
	if err != nil {
		return t, err
	}
	if t.Until != "" && next.Format("2006-01-02") > t.Until {
		t.Done = true
		return t, nil
	}
	t.Date = next.Format("2006-01-02")
	if !ValidDate(t.Date) {
		return t, errors.New("Next occurrence exceeds the supported date range")
	}
	return t, nil
}

// Today is the calendar date in the task's own timezone.
func (t Task) Today(now time.Time) string {
	location, err := time.LoadLocation(t.Timezone)
	if err != nil {
		location = time.UTC
	}
	return now.In(location).Format("2006-01-02")
}

// CatchUp moves a task that skips missed days past occurrences before today.
// Missed days are not completed; they simply lapse, and a schedule whose end
// date passed ends. Other tasks keep their overdue occurrence until completed.
func CatchUp(t Task, now time.Time) Task {
	if !t.SkipsMissed() || t.Done || t.Deleted || t.Date == "" {
		return t
	}
	today := t.Today(now)
	for i := 0; t.Date < today && !t.Done && i < 100000; i++ {
		next, err := Complete(t)
		if err != nil {
			break
		}
		t = next
	}
	return t
}

// Occurrences lists scheduled dates from the schedule's start up to and
// including through, newest last, keeping at most limit of the latest.
func Occurrences(t Task, through string, limit int) []string {
	out := []string{}
	if t.Repeat == "none" || t.StartsOn == "" {
		return out
	}
	c := t
	c.Date, c.Done, c.Until = t.StartsOn, false, ""
	for i := 0; c.Date <= through && i < 100000; i++ {
		if t.Until != "" && c.Date > t.Until {
			break
		}
		out = append(out, c.Date)
		next, err := Complete(c)
		if err != nil || next.Date == c.Date {
			break
		}
		c = next
	}
	if len(out) > limit {
		out = out[len(out)-limit:]
	}
	return out
}
