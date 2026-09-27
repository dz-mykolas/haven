// Package assistant defines Haven's built-in skill catalog and application-owned
// policy. Skill instructions never grant permission to invoke a model or write data.
package assistant

import (
	"context"
	"embed"
	"errors"
	"fmt"
)

//go:embed skills/*/SKILL.md
var files embed.FS

type Skill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Background  bool   `json:"supports_background"`
}

var catalog = []Skill{
	{"review-transaction", "Review transactions", "Automatically categorize transactions and suggest recurring payment schedules.", true},
	{"plan-task", "Plan tasks", "Plan purchases, appointments, and reminders.", false},
	{"organize-money", "Organize Money", "Organize attached transactions with categories and tags.", false},
}

func Catalog() []Skill { return append([]Skill{}, catalog...) }
func Lookup(id string) (Skill, bool) {
	for _, skill := range catalog {
		if skill.ID == id {
			return skill, true
		}
	}
	return Skill{}, false
}
func Instructions(id string) (string, error) {
	if _, ok := Lookup(id); !ok {
		return "", errors.New("Unknown assistant skill")
	}
	data, err := files.ReadFile("skills/" + id + "/SKILL.md")
	return string(data), err
}

type Settings struct {
	Mode                string          `json:"mode"`
	Presentation        string          `json:"presentation"`
	OfferEstimatedCosts bool            `json:"offer_estimated_costs"`
	Skills              map[string]bool `json:"skills"`
	Version             int64           `json:"version"`
}

func Defaults() Settings {
	enabled := map[string]bool{}
	for _, skill := range catalog {
		enabled[skill.ID] = true
	}
	return Settings{Mode: "manual", Presentation: "button", OfferEstimatedCosts: true, Skills: enabled}
}

func (s Settings) Validate() error {
	if s.Mode != "manual" && s.Mode != "on_request" && s.Mode != "proactive" {
		return errors.New("Choose a supported assistant mode")
	}
	if s.Presentation != "button" && s.Presentation != "card" {
		return errors.New("Choose a supported draft presentation")
	}
	if s.Version < 0 {
		return errors.New("Invalid settings version")
	}
	if len(s.Skills) != len(catalog) {
		return errors.New("Include a setting for every available skill")
	}
	for id := range s.Skills {
		if _, ok := Lookup(id); !ok {
			return errors.New("Unknown assistant skill")
		}
	}
	return nil
}

// Authorize is checked before obtaining model context and again before publishing
// a result. It is independent of which provider is used or how a skill is worded.
func (s Settings) Authorize(id, trigger string) error {
	if err := s.Validate(); err != nil {
		return err
	}
	skill, ok := Lookup(id)
	if !ok {
		return errors.New("Unknown assistant skill")
	}
	if s.Mode == "manual" {
		return errors.New("Assistant is off in manual mode")
	}
	if !s.Skills[id] {
		return errors.New("This skill is disabled")
	}
	switch trigger {
	case "chat", "task_followup":
		// Instructions in a task's notes are the user's own request.
		return nil
	case "transaction_imported":
		if s.Mode == "proactive" && skill.Background {
			return nil
		}
	}
	return errors.New("This skill cannot run for that trigger")
}

type SettingsSource interface {
	AssistantSettings(context.Context) (Settings, error)
}
type Invocation struct {
	Skill        Skill
	Instructions string
	Settings     Settings
}

// Run is the shared boundary for future model adapters and background workers.
// The callback must produce a draft, never persist business records. Reloading
// policy afterwards discards stale output if the user changes their preferences.
func Run(ctx context.Context, source SettingsSource, id, trigger string, propose func(context.Context, Invocation) error) error {
	settings, err := source.AssistantSettings(ctx)
	if err != nil {
		return err
	}
	if err = settings.Authorize(id, trigger); err != nil {
		return err
	}
	instructions, err := Instructions(id)
	if err != nil {
		return err
	}
	skill, _ := Lookup(id)
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = propose(ctx, Invocation{skill, instructions, settings}); err != nil {
		return err
	}
	latest, err := source.AssistantSettings(ctx)
	if err != nil {
		return err
	}
	if err = latest.Authorize(id, trigger); err != nil {
		return err
	}
	if latest.Version != settings.Version {
		return fmt.Errorf("Assistant preferences changed; discard this draft and try again")
	}
	return ctx.Err()
}
