package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"github.com/jackc/pgx/v5"
)

func TestAccountLogoIsDownloadedOnceAndServedFromCache(t *testing.T) {
	database := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("set HAVEN_TEST_DATABASE_URL for PostgreSQL logo tests")
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
	if _, err := s.Pool.Exec(ctx, `TRUNCATE bank_logos, bank_ledger_transactions, bank_ledger_accounts`); err != nil {
		t.Fatal(err)
	}
	var withLogo, withoutLogo string
	for bank, id := range map[string]*string{"SEB": &withLogo, "Plain Bank": &withoutLogo} {
		err := s.Pool.QueryRow(ctx, `INSERT INTO bank_ledger_accounts(app_id,bank_name,country,identity_hash,environment,name,currency,iban,balance_minor)
			VALUES('test-app',$1,'LT',$1,'SANDBOX',$1,'EUR','',0) RETURNING id::text`, bank).Scan(id)
		if err != nil {
			t.Fatal(err)
		}
	}
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	keyPath := filepath.Join(t.TempDir(), "test.pem")
	os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}), 0600)
	lists, downloads := 0, 0
	client, err := banking.New(banking.Config{AppID: "test-app", KeyPath: keyPath, RedirectURL: "http://localhost:4321/api/banking/callback"}, bankTransport(func(r *http.Request) (*http.Response, error) {
		reply := func(kind, body string) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {kind}}, Body: io.NopCloser(strings.NewReader(body))}, nil
		}
		if r.URL.Host == "api.enablebanking.com" && r.URL.Path == "/aspsps" {
			lists++
			data, _ := json.Marshal(map[string]any{"aspsps": []banking.Bank{
				{Name: "SEB", Country: "LT", Logo: "https://cdn.enablebanking.com/brands/LT/SEB.svg"},
				{Name: "Plain Bank", Country: "LT"},
			}})
			return reply("application/json", string(data))
		}
		if r.URL.Host == "cdn.enablebanking.com" {
			downloads++
			return reply("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"/>`)
		}
		t.Fatalf("unexpected request %s", r.URL)
		return nil, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	h := New(s, []string{"http://127.0.0.1:4321"}, client)
	get := func(id string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/accounts/"+id+"/logo", nil)
		req.Host = "127.0.0.1:8080"
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	for round := 1; round <= 2; round++ {
		res := get(withLogo)
		if res.Code != 200 || res.Header().Get("Content-Type") != "image/svg+xml" || !strings.Contains(res.Body.String(), "<svg") {
			t.Fatalf("round %d: got %d %q", round, res.Code, res.Header().Get("Content-Type"))
		}
		if !strings.Contains(res.Header().Get("Content-Security-Policy"), "sandbox") {
			t.Fatal("logos must be served with a sandboxing policy")
		}
	}
	if lists != 1 || downloads != 1 {
		t.Fatalf("logo should be fetched once and then cached, got %d lists and %d downloads", lists, downloads)
	}
	for round := 1; round <= 2; round++ {
		if res := get(withoutLogo); res.Code != 404 {
			t.Fatalf("a bank without a logo should be 404, got %d", res.Code)
		}
	}
	if lists != 2 {
		t.Fatalf("a missing logo should be remembered, got %d lists", lists)
	}
	if res := get("00000000-0000-0000-0000-000000000000"); res.Code != 404 {
		t.Fatalf("unknown accounts should be 404, got %d", res.Code)
	}
}
