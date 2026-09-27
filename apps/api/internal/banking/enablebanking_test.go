package banking

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func newTestClient(t *testing.T, f func(*http.Request) (int, any)) *Client {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(t.TempDir(), "key.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), 0600); err != nil {
		t.Fatal(err)
	}
	c, err := New(Config{"test-app", file, "http://localhost:4321/api/banking/callback"}, roundTrip(func(r *http.Request) (*http.Response, error) {
		parts := strings.Split(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), ".")
		if len(parts) != 3 {
			t.Fatal("missing signed JWT")
		}
		signature, _ := base64.RawURLEncoding.DecodeString(parts[2])
		hash := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if err := rsa.VerifyPKCS1v15(&key.PublicKey, crypto.SHA256, hash[:], signature); err != nil {
			t.Fatal(err)
		}
		header, _ := base64.RawURLEncoding.DecodeString(parts[0])
		claims, _ := base64.RawURLEncoding.DecodeString(parts[1])
		var h map[string]string
		var p map[string]any
		json.Unmarshal(header, &h)
		json.Unmarshal(claims, &p)
		if h["alg"] != "RS256" || h["kid"] != "test-app" || p["iss"] != "enablebanking.com" || p["aud"] != "api.enablebanking.com" || p["exp"].(float64)-p["iat"].(float64) != 300 {
			t.Fatalf("wrong JWT claims: %s %s", header, claims)
		}
		if r.URL.Scheme != "https" || r.URL.Host != "api.enablebanking.com" {
			t.Fatal("wrong provider endpoint")
		}
		status, value := f(r)
		data, _ := json.Marshal(value)
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(string(data)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func appResponse() any {
	return map[string]any{"environment": "SANDBOX", "active": true, "redirect_urls": []string{"http://localhost:4321/api/banking/callback"}}
}
func TestSandboxProtocol(t *testing.T) {
	pageCalls := 0
	c := newTestClient(t, func(r *http.Request) (int, any) {
		switch r.URL.Path {
		case "/application":
			return 200, appResponse()
		case "/aspsps":
			if r.URL.Query().Get("country") != "LT" {
				t.Fatal("country not filtered")
			}
			return 200, map[string]any{"aspsps": []Bank{{"Mock ASPSP", "LT", 3600, []string{"personal"}, ""}, {"Business only", "LT", 3600, []string{"business"}, ""}}}
		case "/auth":
			var body struct {
				Access struct {
					ValidUntil   time.Time `json:"valid_until"`
					Balances     bool      `json:"balances"`
					Transactions bool      `json:"transactions"`
				} `json:"access"`
				PSU      string `json:"psu_type"`
				State    string `json:"state"`
				Redirect string `json:"redirect_url"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body.PSU != "personal" || body.State != "random-state" || body.Redirect != "http://localhost:4321/api/banking/callback" || !body.Access.Balances || !body.Access.Transactions {
				t.Fatal("wrong auth request")
			}
			if d := time.Until(body.Access.ValidUntil); d < 59*time.Minute || d > time.Hour {
				t.Fatal("did not respect bank consent maximum")
			}
			return 200, map[string]string{"url": "https://auth.enablebanking.com/ais/start?sessionid=secret"}
		case "/accounts/account-1/balances":
			return 200, map[string]any{"balances": []Balance{{Name: "Booked", Amount: Amount{"1234567890.01", "EUR"}, Type: "CLBD"}}}
		case "/accounts/account-1/transactions":
			pageCalls++
			if pageCalls == 1 {
				return 200, map[string]any{"transactions": []Transaction{{Reference: "a", Amount: Amount{"12.34", "EUR"}, Status: "PDNG", Direction: "DBIT"}}, "continuation_key": "opaque +/& cursor"}
			}
			if r.URL.Query().Get("continuation_key") != "opaque +/& cursor" {
				t.Fatal("cursor not preserved")
			}
			return 200, map[string]any{"transactions": []Transaction{{Reference: "b", Amount: Amount{"0.01", "EUR"}, Status: "BOOK", Direction: "CRDT"}}}
		default:
			t.Fatalf("unexpected request %s", r.URL)
			return 500, nil
		}
	})
	banks, err := c.Banks(context.Background())
	if err != nil || len(banks) != 1 {
		t.Fatalf("banks: %+v %v", banks, err)
	}
	if _, err := c.Authorize(context.Background(), banks[0], "random-state"); err != nil {
		t.Fatal(err)
	}
	snapshot, err := c.Snapshot(context.Background(), Session{Accounts: []Account{{UID: "account-1", IdentificationHash: "stable"}, {IdentificationHash: "blocked"}}})
	if err != nil {
		t.Fatal(err)
	}
	if pageCalls != 2 || len(snapshot) != 2 || len(snapshot[0].Transactions) != 2 || snapshot[0].Balances[0].Amount.Amount != "1234567890.01" || snapshot[0].Transactions[0].Status != "PDNG" || len(snapshot[1].Transactions) != 0 {
		t.Fatalf("bad snapshot %+v", snapshot)
	}
}
func TestSandboxGuardsAndRedaction(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		response any
		message  string
	}{
		{"production", 200, map[string]any{"environment": "PRODUCTION", "active": true}, "sandbox applications only"},
		{"wrong callback", 200, map[string]any{"environment": "SANDBOX", "active": true, "redirect_urls": []string{}}, "exact EB_REDIRECT_URL"},
		{"rate limit", 429, map[string]string{"error": "secret-code-and-session"}, "rate limiting"},
		{"unauthorized", 401, map[string]string{"error": "secret-code-and-session"}, "rejected access"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t, func(r *http.Request) (int, any) {
				if r.URL.Path != "/application" {
					t.Fatal("must stop before fetching banks")
				}
				return tc.status, tc.response
			})
			_, err := c.Banks(context.Background())
			if err == nil || !strings.Contains(err.Error(), tc.message) || strings.Contains(err.Error(), "secret-code") {
				t.Fatalf("bad error: %v", err)
			}
		})
	}
}
func TestRepeatedPaginationFailsWithoutPartialResult(t *testing.T) {
	calls := 0
	c := newTestClient(t, func(r *http.Request) (int, any) {
		switch r.URL.Path {
		case "/application":
			return 200, appResponse()
		case "/accounts/a/balances":
			return 200, map[string]any{"balances": []any{}}
		default:
			calls++
			return 200, map[string]any{"transactions": []any{}, "continuation_key": "repeated"}
		}
	})
	snapshot, err := c.Snapshot(context.Background(), Session{Accounts: []Account{{UID: "a"}}})
	if err == nil || snapshot != nil || calls != 2 {
		t.Fatal(fmt.Sprintf("expected bounded pagination failure: %+v %v %d", snapshot, err, calls))
	}
}

func TestRefreshLostAccountAccess(t *testing.T) {
	for _, tc := range []struct {
		name    string
		code    string
		detail  any
		status  int
		message string
	}{
		{"replaced mock account", "ASPSP_ERROR", map[string]any{"message": "Forbidden, authenticated but access to resource is not allowed", "error_data": "private-provider-data"}, 410, "select the current mock accounts"},
		{"inaccessible account", "ASPSP_ACCOUNT_NOT_ACCESSIBLE", "private-provider-data", 410, "select the current mock accounts"},
		{"deleted account", "ACCOUNT_DOES_NOT_EXIST", nil, 410, "select the current mock accounts"},
		{"revoked session", "REVOKED_SESSION", nil, 410, "Reconnect the test bank"},
		{"expired session", "EXPIRED_SESSION", nil, 410, "Reconnect the test bank"},
		{"unrelated bank error", "ASPSP_ERROR", map[string]string{"message": "private-provider-data"}, 502, "Please try again"},
		{"unknown error", "private-provider-data", []string{"private-provider-data"}, 502, "Please try again"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newTestClient(t, func(r *http.Request) (int, any) {
				if r.URL.Path == "/application" {
					return 200, appResponse()
				}
				return 400, map[string]any{"error": tc.code, "message": "private-provider-data", "detail": tc.detail}
			})
			snapshot, err := c.Snapshot(context.Background(), Session{Accounts: []Account{{UID: "private-provider-data"}}})
			failure, ok := err.(*Error)
			if !ok || failure.Status != tc.status || !strings.Contains(failure.Message, tc.message) || strings.Contains(failure.Message, "private-provider-data") || snapshot != nil {
				t.Fatalf("unexpected refresh error or partial snapshot: %v", err)
			}
		})
	}
}
