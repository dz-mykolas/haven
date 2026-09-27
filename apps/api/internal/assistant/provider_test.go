package assistant

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderProtocols(t *testing.T) {
	for _, protocol := range []string{"chat_completions", "responses"} {
		t.Run(protocol, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer test-key" {
					t.Error("incorrect request authentication or method")
				}
				var body map[string]json.RawMessage
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Fatal("invalid payload")
				}
				if string(body["model"]) != `"test-model"` {
					t.Error("incorrect model")
				}
				if protocol == "chat_completions" {
					if r.URL.Path != "/v1/chat/completions" {
						t.Error(r.URL.Path)
					}
					var messages []Message
					json.Unmarshal(body["messages"], &messages)
					if len(messages) != 2 || messages[0].Role != "system" || messages[0].Content != "instructions" || messages[1].Content != "hello" {
						t.Errorf("incorrect history: %+v", messages)
					}
					w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"OK"}}]}`))
				} else {
					if r.URL.Path != "/v1/responses" || string(body["instructions"]) != `"instructions"` || string(body["store"]) != "false" {
						t.Error("incorrect Responses request")
					}
					w.Write([]byte(`{"status":"completed","output":[{"type":"reasoning"},{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}`))
				}
			}))
			defer server.Close()
			got, err := Complete(context.Background(), Provider{BaseURL: server.URL + "/v1", Model: "test-model", Protocol: protocol}, "test-key", "instructions", []Message{{Role: "user", Content: "hello"}})
			if err != nil || got != "OK" {
				t.Fatalf("got %q, %v", got, err)
			}
		})
	}
}
func TestProviderFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
	}{
		{"auth", 401, `secret-key in provider error`},
		{"truncated", 200, `{"choices":[{"finish_reason":"length","message":{"content":"partial"}}]}`},
		{"wrong format", 200, `{"output_text":"not chat"}`},
		{"empty", 200, `{"choices":[{"message":{"content":""}}]}`},
		{"oversize", 200, strings.Repeat("x", (1<<20)+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.code); w.Write([]byte(tc.body)) }))
			defer server.Close()
			_, err := Complete(context.Background(), Provider{BaseURL: server.URL, Protocol: "chat_completions"}, "secret-key", "", nil)
			if err == nil || strings.Contains(err.Error(), "secret-key") {
				t.Fatalf("unsafe/missing failure: %v", err)
			}
		})
	}
	hits := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits++ }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer redirect.Close()
	_, err := Complete(context.Background(), Provider{BaseURL: redirect.URL}, "secret-key", "", nil)
	if err == nil || hits != 0 {
		t.Fatal("followed redirect with credentials")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = Complete(ctx, Provider{BaseURL: target.URL}, "", "", nil); err != context.Canceled {
		t.Fatalf("cancellation not propagated: %v", err)
	}
}
func TestProviderValidation(t *testing.T) {
	for _, url := range []string{"http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=secret", "file:///tmp/key", "http://169.254.169.254/"} {
		p := ProviderUpdate{BaseURL: url, Model: "model", Protocol: "chat_completions"}
		if p.Validate() == nil {
			t.Errorf("accepted %s", url)
		}
	}
	p := ProviderUpdate{BaseURL: " http://localhost:1234/v1/chat/completions/ ", Model: " model ", Protocol: "chat_completions"}
	if err := p.Validate(); err != nil || p.BaseURL != "http://localhost:1234/v1" || p.Model != "model" {
		t.Fatalf("normalization failed: %+v %v", p, err)
	}
}
