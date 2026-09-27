package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestAssistantPreferences(t *testing.T) {
	database := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("requires disposable PostgreSQL")
	}
	cfg, err := pgx.ParseConfig(database)
	if err != nil || !strings.HasSuffix(cfg.Database, "_test") {
		t.Fatal("test database must end in _test")
	}
	ctx := context.Background()
	s, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Pool.Close()
	_, err = s.Pool.Exec(ctx, `UPDATE assistant_settings SET mode='manual',presentation='button',offer_estimated_costs=true,skills='{"review-transaction":true,"plan-task":true,"organize-money":true}',version=1`)
	if err != nil {
		t.Fatal(err)
	}
	handler := New(s, []string{"http://localhost:4321"})
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(method, "http://localhost:4321/api"+path, bytes.NewReader(raw))
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: got %d %s want %d", method, path, w.Code, w.Body, want)
		}
		return w.Body.Bytes()
	}
	var state AssistantStatus
	json.Unmarshal(call("GET", "/assistant", nil, 200), &state)
	if state.Settings.Mode != "manual" || state.ModelConnected || len(state.Skills) != 3 {
		t.Fatalf("incorrect defaults: %+v", state)
	}
	input := state.Settings
	input.Mode = "proactive"
	input.Presentation = "card"
	input.OfferEstimatedCosts = false
	input.Skills["organize-money"] = false
	var saved assistant.Settings
	json.Unmarshal(call("PUT", "/assistant/settings", input, 200), &saved)
	call("PUT", "/assistant/settings", input, 200) // Retry must not increment the revision.
	if saved.Version != 2 {
		t.Fatalf("incorrect version: %d", saved.Version)
	}
	stale := input
	stale.Mode = "on_request"
	call("PUT", "/assistant/settings", stale, 409)
	invalid := saved
	invalid.Mode = "automatic"
	call("PUT", "/assistant/settings", invalid, 400)
	invalid = saved
	invalid.Presentation = "popup"
	call("PUT", "/assistant/settings", invalid, 400)
	reopened, err := store.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	handler = New(reopened, []string{"http://localhost:4321"})
	json.Unmarshal(call("GET", "/assistant", nil, 200), &state)
	if state.Settings.Mode != "proactive" || state.Settings.OfferEstimatedCosts || state.Settings.Skills["organize-money"] || state.Settings.Presentation != "card" || state.Settings.Version != 2 {
		t.Fatal("preferences did not persist")
	}
	var backup store.Backup
	json.Unmarshal(call("GET", "/export", nil, 200), &backup)
	if backup.AssistantSettings.Version != 2 {
		t.Fatal("preferences missing from export")
	}
	saved.Mode = "manual"
	json.Unmarshal(call("PUT", "/assistant/settings", saved, 200), &saved)
	if saved.Skills["organize-money"] || saved.OfferEstimatedCosts || saved.Presentation != "card" {
		t.Fatal("manual mode erased other preferences")
	}
	call("PUT", "/assistant/settings", map[string]any{"mode": "manual"}, 400)
	// Return the isolated test workspace to defaults for other tests.
	defaults := assistant.Defaults()
	defaults.Version = saved.Version
	call("PUT", "/assistant/settings", defaults, 200)
}
