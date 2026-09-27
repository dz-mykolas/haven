package domain

import (
	"sort"
	"time"
)

type TaskOccurrence struct {
	Task      Task   `json:"task"`
	Date      string `json:"date"`
	Projected bool   `json:"projected"`
	Completed bool   `json:"completed"`
}
type TaskCalendar struct {
	Month string           `json:"month"`
	From  string           `json:"from"`
	To    string           `json:"to"`
	Items []TaskOccurrence `json:"items"`
}

// CalendarBounds gives a Monday-first, six-week view for a validated month.
func CalendarBounds(month string) (time.Time, time.Time) {
	first, _ := time.Parse("2006-01", month)
	from := first.AddDate(0, 0, -(int(first.Weekday())+6)%7)
	return from, from.AddDate(0, 0, 41)
}

// Calendar is a read-only projection; future repeats are not persisted tasks.
// Completion still advances exactly one occurrence using Complete.
func Calendar(tasks []Task, completions []Completion, month string) TaskCalendar {
	from, to := CalendarBounds(month)
	result := TaskCalendar{Month: month, From: from.Format("2006-01-02"), To: to.Format("2006-01-02"), Items: []TaskOccurrence{}}
	byID := map[string]Task{}
	items := map[string]TaskOccurrence{}
	for _, task := range tasks {
		if task.Deleted || !task.CalendarVisible() || task.Date == "" {
			continue
		}
		byID[task.ID] = task
		cursor := task
		// Step to the visible range with the same rules completion uses, so
		// intervals, weekdays and end dates all project correctly.
		for i := 0; !task.Done && cursor.Repeat != "none" && cursor.Date < result.From && i < 100000; i++ {
			next, err := Complete(cursor)
			if err != nil || next.Date == cursor.Date {
				break
			}
			cursor = next
		}
		for cursor.Date <= result.To {
			if cursor.Date >= result.From {
				items[task.ID+":"+cursor.Date] = TaskOccurrence{Task: task, Date: cursor.Date, Projected: cursor.Date != task.Date, Completed: task.Done || (task.Forecast() && task.Plan.ReminderCompletedOn == cursor.Date)}
			}
			if task.Done || task.Repeat == "none" {
				break
			}
			next, err := Complete(cursor)
			if err != nil || next.Done {
				break
			}
			cursor = next
		}
	}
	for _, completion := range completions {
		task, ok := byID[completion.TaskID]
		if !ok || completion.DueDate < result.From || completion.DueDate > result.To {
			continue
		}
		items[task.ID+":"+completion.DueDate] = TaskOccurrence{Task: task, Date: completion.DueDate, Completed: true}
	}
	for _, item := range items {
		result.Items = append(result.Items, item)
	}
	sort.Slice(result.Items, func(i, j int) bool {
		a, b := result.Items[i], result.Items[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if a.Task.Time != b.Task.Time {
			return a.Task.Time < b.Task.Time
		}
		if a.Task.Title != b.Task.Title {
			return a.Task.Title < b.Task.Title
		}
		return a.Task.ID < b.Task.ID
	})
	return result
}
