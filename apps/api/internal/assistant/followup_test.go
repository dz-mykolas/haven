package assistant

import (
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

func TestFollowUpPromptUsesSkillFiles(t *testing.T) {
	task := domain.Task{ID: "t", Title: "Stretches", Timezone: "UTC", Repeat: "daily", Kind: "task"}
	read := FollowUpPrompt(FollowUpContext{Phase: "saved", Today: "2027-03-01", Task: task})
	check := FollowUpPrompt(FollowUpContext{Phase: "check", Today: "2027-03-01", Task: task})
	for _, want := range []string{"name: follow-up", "## When a task is saved", "REPLY FORMAT (task saved)"} {
		if !strings.Contains(read, want) || strings.Contains(read, "## When the check date arrives") {
			t.Fatalf("read prompt missing %q or includes the check instructions", want)
		}
	}
	for _, want := range []string{"name: follow-up", "## When the check date arrives", "REPLY FORMAT (check)"} {
		if !strings.Contains(check, want) || strings.Contains(check, "## When a task is saved") {
			t.Fatalf("check prompt missing %q or includes the read instructions", want)
		}
	}
	// The chat model is never offered the follow-up skill.
	settings := Defaults()
	settings.Mode = "on_request"
	if strings.Contains(ChatPrompt(settings, "UTC", nil, nil, nil, nil), "name: follow-up") {
		t.Fatal("follow-up instructions leaked into chat")
	}
	if settings.WithSkills(nil).Skills["follow-up"] != true || (Settings{Skills: map[string]bool{}}).WithSkills(map[string]bool{"follow-up": false}).Skills["follow-up"] {
		t.Fatal("missing skills should keep their saved value, else default on")
	}
}
