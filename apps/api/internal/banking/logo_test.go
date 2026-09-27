package banking

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// logoClient answers the bank list from api.enablebanking.com and serves the
// listed logo address from another host, as Enable Banking does.
func logoClient(t *testing.T, logo string, image func() (int, string, string)) *Client {
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
		reply := func(status int, kind, body string) (*http.Response, error) {
			return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {kind}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		}
		if r.URL.Host == "api.enablebanking.com" {
			if r.URL.Path != "/aspsps" || r.URL.Query().Get("country") != "LT" {
				t.Fatalf("unexpected provider call %s", r.URL)
			}
			data, _ := json.Marshal(map[string]any{"aspsps": []Bank{{Name: "SEB", Country: "LT", Logo: logo}, {Name: "Other", Country: "LT"}}})
			return reply(200, "application/json", string(data))
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatal("the logo download must not carry provider credentials")
		}
		status, kind, body := image()
		return reply(status, kind, body)
	}))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestLogoDownloadsTheListedImage(t *testing.T) {
	c := logoClient(t, "https://cdn.enablebanking.com/seb.svg", func() (int, string, string) { return 200, "image/svg+xml; charset=utf-8", "<svg/>" })
	data, kind, err := c.Logo(t.Context(), "SEB", "LT")
	if err != nil || string(data) != "<svg/>" || kind != "image/svg+xml" {
		t.Fatalf("got %q %q %v", data, kind, err)
	}
	data, _, err = c.Logo(t.Context(), "Other", "LT")
	if err != nil || data != nil {
		t.Fatalf("a bank without a logo should return nothing: %q %v", data, err)
	}
}

func TestLogoRejectsUnsafeDownloads(t *testing.T) {
	for name, tc := range map[string]struct {
		logo   string
		status int
		kind   string
		body   string
	}{
		"plain http": {"http://cdn.enablebanking.com/seb.svg", 200, "image/svg+xml", "<svg/>"},
		"not image":  {"https://cdn.enablebanking.com/seb", 200, "text/html", "<html>"},
		"missing":    {"https://cdn.enablebanking.com/seb.svg", 404, "image/svg+xml", ""},
		"too large":  {"https://cdn.enablebanking.com/seb.png", 200, "image/png", strings.Repeat("x", maxLogoBytes+1)},
	} {
		c := logoClient(t, tc.logo, func() (int, string, string) { return tc.status, tc.kind, tc.body })
		if data, _, err := c.Logo(t.Context(), "SEB", "LT"); err == nil {
			t.Errorf("%s: accepted %d bytes", name, len(data))
		}
	}
}
