package assistant

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type source struct {
	settings Settings
	err      error
}

func (s *source) AssistantSettings(context.Context) (Settings, error) { return s.settings, s.err }

func TestPolicyGuardsModelInvocation(t *testing.T) {
	for _, mode := range []string{"manual", "on_request", "proactive"} {
		for _, skill := range Catalog() {
			for _, enabled := range []bool{true, false} {
				for _, trigger := range []string{"chat", "transaction_imported", "unknown"} {
					settings := Defaults()
					settings.Mode = mode
					settings.Skills[skill.ID] = enabled
					calls := 0
					err := Run(context.Background(), &source{settings: settings}, skill.ID, trigger, func(_ context.Context, in Invocation) error {
						calls++
						if !strings.Contains(in.Instructions, "name: "+skill.ID) {
							t.Fatal("wrong or missing instructions")
						}
						return nil
					})
					allowed := mode != "manual" && enabled && (trigger == "chat" || (mode == "proactive" && skill.Background && trigger == "transaction_imported"))
					if (err == nil) != allowed || (calls == 1) != allowed {
						t.Fatalf("%s/%s/%t/%s: calls=%d error=%v", mode, skill.ID, enabled, trigger, calls, err)
					}
				}
			}
		}
	}
}
func TestPolicyDiscardsResultsAfterSettingsChange(t *testing.T) {
	for _, change := range []string{"manual", "skill", "presentation"} {
		settings := Defaults()
		settings.Mode = "on_request"
		settings.Version = 1
		src := &source{settings: settings}
		err := Run(context.Background(), src, "plan-task", "chat", func(_ context.Context, in Invocation) error {
			if change == "manual" {
				src.settings.Mode = "manual"
			}
			if change == "skill" {
				src.settings.Skills["plan-task"] = false
			}
			if change == "presentation" {
				src.settings.Presentation = "card"
			}
			src.settings.Version++
			return nil
		})
		if err == nil {
			t.Fatalf("accepted stale result after %s change", change)
		}
	}
}
func TestPolicyDoesNotBypassErrorsOrCancellation(t *testing.T) {
	settings := Defaults()
	settings.Mode = "on_request"
	settings.OfferEstimatedCosts = false
	src := &source{settings: settings}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if err := Run(ctx, src, "plan-task", "chat", func(context.Context, Invocation) error { called = true; return nil }); !errors.Is(err, context.Canceled) || called {
		t.Fatal("called with cancelled request")
	}
	src.err = errors.New("settings unavailable")
	if err := Run(context.Background(), src, "plan-task", "chat", func(context.Context, Invocation) error { called = true; return nil }); err == nil || called {
		t.Fatal("failed open without settings")
	}
	src.err = nil
	if err := Run(context.Background(), src, "plan-task", "chat", func(_ context.Context, in Invocation) error {
		if in.Settings.OfferEstimatedCosts {
			t.Fatal("lost cost preference")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestSettingsValidation(t *testing.T) {
	for _, mutate := range []func(*Settings){func(s *Settings) { s.Mode = "automatic" }, func(s *Settings) { s.Presentation = "popup" }, func(s *Settings) { s.Skills["unknown"] = true }, func(s *Settings) { delete(s.Skills, "plan-task") }, func(s *Settings) { s.Version = -1 }} {
		settings := Defaults()
		mutate(&settings)
		if settings.Validate() == nil {
			t.Fatal("accepted invalid settings")
		}
	}
	if _, err := Instructions("../plan-task"); err == nil {
		t.Fatal("accepted unknown skill path")
	}
}
