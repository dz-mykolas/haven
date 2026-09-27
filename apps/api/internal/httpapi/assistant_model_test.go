package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestAssistantModel(t *testing.T) {
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
	t.Setenv("HAVEN_LLM_KEY_FILE", filepath.Join(t.TempDir(), "llm.key"))
	reset := func() {
		_, err := s.Pool.Exec(ctx, `UPDATE assistant_provider SET base_url='',model='',protocol='chat_completions',api_key_cipher='',version=1,tested_at=NULL; UPDATE assistant_settings SET mode='manual',presentation='button',offer_estimated_costs=true,skills='{"review-transaction":true,"plan-task":true,"organize-money":true}',version=1`)
		if err != nil {
			t.Fatal(err)
		}
	}
	reset()
	defer reset()
	handler := New(s, []string{"http://localhost:4321"})
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "http://localhost:4321/api"+path, bytes.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s got %d: %s", method, path, w.Code, w.Body)
		}
		return w.Body.Bytes()
	}
	var calls atomic.Int32
	var failRequest atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-secret" {
			t.Error("missing saved API key")
		}
		if failRequest.Load() {
			w.WriteHeader(401)
			w.Write([]byte("test-secret"))
			return
		}
		var payload struct {
			Messages []assistant.Message `json:"messages"`
		}
		json.NewDecoder(r.Body).Decode(&payload)
		content := "OK"
		if !strings.Contains(payload.Messages[0].Content, "connection test") {
			content = `{"message":"Review the appointment","skill_id":"plan-task","task":{"id":"","title":"Model draft only","date":"2026-09-25","time":"16:30","repeat":"none","kind":"appointment","amount_minor":"0","notes":""},"annotations":[]}`
		}
		if payload.Messages[len(payload.Messages)-1].Content == "I will pay 50 euros for it" {
			var previous assistant.ChatReply
			json.Unmarshal([]byte(payload.Messages[len(payload.Messages)-2].Content), &previous)
			if previous.Task == nil {
				t.Error("missing previous draft")
				return
			}
			if !strings.Contains(payload.Messages[0].Content, previous.Task.ID) {
				t.Error("unsaved draft missing from validated application context")
			}
			output, _ := json.Marshal(assistant.ModelReply{Message: "Estimated cost noted", SkillID: "plan-task", Task: &assistant.TaskDraft{ID: previous.Task.ID, Title: previous.Task.Title, Date: previous.Task.Date, Time: previous.Task.Time, Repeat: previous.Task.Repeat, Kind: "appointment", Amount: "5000"}})
			content = string(output)
		}
		json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"content": content}}}})
	}))
	defer provider.Close()
	secret := "test-secret"
	input := assistant.ProviderUpdate{BaseURL: provider.URL + "/v1", Model: "test", Protocol: "chat_completions", APIKey: &secret, Version: 1}
	var saved assistant.Provider
	raw := call("PUT", "/assistant/provider", input, 200)
	json.Unmarshal(raw, &saved)
	if strings.Contains(string(raw), secret) || !saved.HasAPIKey {
		t.Fatal("key metadata unsafe")
	}
	var encrypted []byte
	if err = s.Pool.QueryRow(ctx, "SELECT api_key_cipher FROM assistant_provider WHERE singleton").Scan(&encrypted); err != nil || len(encrypted) == 0 || bytes.Contains(encrypted, []byte(secret)) {
		t.Fatal("API key not encrypted")
	}
	for _, path := range []string{"/assistant", "/export"} {
		if bytes.Contains(call("GET", path, nil, 200), []byte(secret)) {
			t.Fatal("key leaked to client")
		}
	}
	input.APIKey = nil
	input.Version = saved.Version
	json.Unmarshal(call("PUT", "/assistant/provider", input, 200), &saved)
	_, retained, err := s.ProviderCredentials(ctx)
	if err != nil || retained != secret {
		t.Fatal("blank update lost key")
	}
	input.Version = saved.Version
	input.BaseURL = provider.URL + "/other"
	call("PUT", "/assistant/provider", input, 400)
	input.BaseURL = provider.URL + "/v1"
	input.Version = 1
	call("PUT", "/assistant/provider", input, 409)
	request := assistant.ChatRequest{Timezone: "Europe/Vilnius", Messages: []assistant.Message{{Role: "user", Content: "Barber Friday 16:30"}}}
	call("POST", "/assistant/chat", request, 403)
	call("POST", "/assistant/provider/test", map[string]any{"version": saved.Version}, 403)
	if calls.Load() != 0 {
		t.Fatal("manual mode sent model request")
	}
	settings, err := s.AssistantSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.Mode = "on_request"
	json.Unmarshal(call("PUT", "/assistant/settings", settings, 200), &settings)
	var status AssistantStatus
	json.Unmarshal(call("POST", "/assistant/provider/test", map[string]any{"version": saved.Version}, 200), &status)
	if !status.ModelConnected || status.Provider.TestedAt == nil {
		t.Fatal("test not recorded")
	}
	var reply assistant.ChatReply
	json.Unmarshal(call("POST", "/assistant/chat", request, 200), &reply)
	if reply.Task == nil {
		t.Fatal("missing draft")
	}
	var count int
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM tasks WHERE id=$1", reply.Task.ID).Scan(&count)
	if count != 0 {
		t.Fatal("chat wrote task without approval")
	}
	previous, _ := json.Marshal(reply)
	request.Messages = append(request.Messages, assistant.Message{Role: "assistant", Content: string(previous)}, assistant.Message{Role: "user", Content: "I will pay 50 euros for it"})
	request.TaskDrafts = []domain.Task{*reply.Task}
	originalID := reply.Task.ID
	json.Unmarshal(call("POST", "/assistant/chat", request, 200), &reply)
	if reply.Task == nil || reply.Task.ID != originalID || reply.Task.Amount != 0 || reply.Task.Kind != "appointment" || reply.Task.EstimatedMin == nil || *reply.Task.EstimatedMin != 5000 || *reply.Task.EstimatedMax != 5000 || reply.Task.Notes != "" {
		t.Fatalf("follow-up lost appointment: %+v", reply)
	}
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM tasks WHERE id=$1", originalID).Scan(&count)
	if count != 0 {
		t.Fatal("follow-up saved unapproved draft")
	}
	request.TaskDrafts[0].Version = 99
	beforeCalls := calls.Load()
	call("POST", "/assistant/chat", request, 502)
	if calls.Load() != beforeCalls {
		t.Fatal("invalid draft reached provider")
	}
	failRequest.Store(true)
	raw = call("POST", "/assistant/provider/test", map[string]any{"version": saved.Version}, 502)
	if bytes.Contains(raw, []byte(secret)) {
		t.Fatal("provider error leaked key")
	}
	json.Unmarshal(call("GET", "/assistant", nil, 200), &status)
	if status.ModelConnected {
		t.Fatal("failed test kept success status")
	}
	empty := ""
	input.Version = saved.Version
	input.APIKey = &empty
	json.Unmarshal(call("PUT", "/assistant/provider", input, 200), &saved)
	_, retained, err = s.ProviderCredentials(ctx)
	if err != nil || retained != "" || saved.HasAPIKey {
		t.Fatal("key not cleared")
	}
	call("DELETE", "/assistant/provider", map[string]any{"version": saved.Version}, 200)
	json.Unmarshal(call("GET", "/assistant", nil, 200), &status)
	if status.Provider.BaseURL != "" || status.Provider.HasAPIKey {
		t.Fatal("connection not removed")
	}
}
