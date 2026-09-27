package domain

import (
	"math/big"
	"sort"
	"time"
)

type UpcomingCost struct {
	Task      Task   `json:"task"`
	Date      string `json:"date"`
	DateUntil string `json:"date_until"`
	Event     string `json:"event"`
	Group     string `json:"group"`
	Included  bool   `json:"included"`
	Minimum   *int64 `json:"minimum_minor,string"`
	Maximum   *int64 `json:"maximum_minor,string"`
}
type CostSubtotal struct {
	Minimum string `json:"minimum_minor"`
	Maximum string `json:"maximum_minor"`
	Unknown int    `json:"unknown_count"`
}
type UpcomingCosts struct {
	From      string         `json:"from"`
	To        string         `json:"to"`
	Minimum   string         `json:"minimum_minor"`
	Maximum   string         `json:"maximum_minor"`
	Unknown   int            `json:"unknown_count"`
	Scheduled CostSubtotal   `json:"scheduled"`
	Expected  CostSubtotal   `json:"expected"`
	Items     []UpcomingCost `json:"items"`
}

func (t Task) Cost() (*int64, *int64) {
	if t.EstimatedMin != nil && t.EstimatedMax != nil {
		return t.EstimatedMin, t.EstimatedMax
	}
	if t.Kind == "payment" && t.Amount > 0 {
		amount := t.Amount
		return &amount, &amount
	}
	return nil, nil
}

// Forecasts contribute once per plan; scheduled occurrences contribute once
// per occurrence. Exclusion retains visibility without changing actual spending.
func Upcoming(tasks []Task, from string) UpcomingCosts {
	start, _ := time.Parse("2006-01-02", from)
	end := start.AddDate(0, 0, 29)
	result := UpcomingCosts{From: from, To: end.Format("2006-01-02"), Items: []UpcomingCost{}}
	relevant := []Task{}
	for _, t := range tasks {
		if t.Done || t.Deleted {
			continue
		}
		min, max := t.Cost()
		if t.Forecast() {
			date, until, event := t.Date, t.Plan.DateUntil, "payment"
			if t.Plan.Kind == "prepaid" && t.Plan.ExpiresOn != "" {
				if date == "" || date == t.Plan.ExpiresOn || !t.Included() || (date > result.To && t.Plan.ExpiresOn <= result.To && t.Plan.ExpiresOn >= from) {
					event = "expiry"
					date = t.Plan.ExpiresOn
					until = ""
				}
			}
			if until == "" {
				until = date
			}
			if date != "" && (date > result.To || until < from) {
				continue
			}
			result.Items = append(result.Items, UpcomingCost{Task: t, Date: date, DateUntil: until, Event: event, Group: "expected", Included: t.Included(), Minimum: min, Maximum: max})
		} else if min != nil || t.Kind == "payment" {
			relevant = append(relevant, t)
		}
	}
	seen := map[string]bool{}
	for month := time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC); !month.After(end); month = month.AddDate(0, 1, 0) {
		for _, item := range Calendar(relevant, nil, month.Format("2006-01")).Items {
			key := item.Task.ID + ":" + item.Date
			if item.Completed || item.Date < from || item.Date > result.To || seen[key] {
				continue
			}
			seen[key] = true
			min, max := item.Task.Cost()
			group := "scheduled"
			if item.Task.Kind != "payment" {
				group = "expected"
			}
			result.Items = append(result.Items, UpcomingCost{Task: item.Task, Date: item.Date, DateUntil: item.Date, Event: "payment", Group: group, Included: item.Task.Included(), Minimum: min, Maximum: max})
		}
	}
	sums := map[string][2]*big.Int{"scheduled": {new(big.Int), new(big.Int)}, "expected": {new(big.Int), new(big.Int)}}
	unknown := map[string]int{}
	for _, item := range result.Items {
		if !item.Included {
			continue
		}
		if item.Task.Forecast() && item.Task.Date != "" {
			until := item.Task.Plan.DateUntil
			if until == "" {
				until = item.Task.Date
			}
			if item.Task.Date > result.To || until < from {
				continue
			}
		}
		if item.Minimum == nil || item.Date == "" {
			unknown[item.Group]++
			continue
		}
		sum := sums[item.Group]
		sum[0].Add(sum[0], big.NewInt(*item.Minimum))
		sum[1].Add(sum[1], big.NewInt(*item.Maximum))
	}
	result.Scheduled = CostSubtotal{sums["scheduled"][0].String(), sums["scheduled"][1].String(), unknown["scheduled"]}
	result.Expected = CostSubtotal{sums["expected"][0].String(), sums["expected"][1].String(), unknown["expected"]}
	result.Minimum = new(big.Int).Add(sums["scheduled"][0], sums["expected"][0]).String()
	result.Maximum = new(big.Int).Add(sums["scheduled"][1], sums["expected"][1]).String()
	result.Unknown = unknown["scheduled"] + unknown["expected"]
	sort.Slice(result.Items, func(i, j int) bool {
		a, b := result.Items[i], result.Items[j]
		if a.Date != b.Date {
			if a.Date == "" {
				return false
			}
			if b.Date == "" {
				return true
			}
			return a.Date < b.Date
		}
		if a.Task.Title != b.Task.Title {
			return a.Task.Title < b.Task.Title
		}
		return a.Task.ID < b.Task.ID
	})
	return result
}
