package assistant

import (
	"strings"
	"testing"
)

func TestPromptScopesSkillsAndContracts(t *testing.T) {
	for _, enabled := range []string{"plan-task", "review-transaction", "organize-money"} {
		t.Run(enabled, func(t *testing.T) {
			settings := Defaults()
			settings.Mode = "on_request"
			settings.OfferEstimatedCosts = false
			for id := range settings.Skills {
				settings.Skills[id] = id == enabled
			}
			prompt := ChatPrompt(settings, "Europe/Vilnius", nil, nil, nil, nil)
			for _, skill := range Catalog() {
				instructions, err := Instructions(skill.ID)
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(prompt, instructions) != (skill.ID == enabled) {
					t.Fatalf("wrong instruction visibility for %s", skill.ID)
				}
			}
			if strings.Contains(prompt, taskContract) != (enabled == "plan-task") {
				t.Fatal("task contract exposed without task skill")
			}
			if strings.Contains(prompt, annotationContract) != (enabled != "plan-task") {
				t.Fatal("annotation contract exposed without Money skill")
			}
			if !strings.Contains(prompt, `"offer_estimated_costs":false`) {
				t.Fatal("current preference missing")
			}
		})
	}
}
