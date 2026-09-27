// Package banking implements Enable Banking account-information access.
// This first connection slice deliberately accepts SANDBOX applications only.
package banking

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"
)

const baseURL = "https://api.enablebanking.com"
const CallbackPath = "/api/banking/callback"

type Config struct{ AppID, KeyPath, RedirectURL string }
type Client struct {
	config Config
	key    *rsa.PrivateKey
	http   *http.Client
}

// Error never includes response bodies, authorization codes, keys, or session IDs.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string     { return e.Message }
func problem(message string) error { return &Error{502, message} }

type Bank struct {
	Name       string   `json:"name"`
	Country    string   `json:"country"`
	MaxConsent int64    `json:"maximum_consent_validity"`
	PSUTypes   []string `json:"psu_types"`
	Logo       string   `json:"logo,omitempty"`
}
type Amount struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}
type Balance struct {
	Name          string `json:"name"`
	Amount        Amount `json:"balance_amount"`
	Type          string `json:"balance_type"`
	ReferenceDate string `json:"reference_date,omitempty"`
}
type Party struct {
	Name string `json:"name"`
}
type AccountIdentification struct {
	IBAN string `json:"iban,omitempty"`
}
type Transaction struct {
	CreditorAccount AccountIdentification `json:"creditor_account"`
	DebtorAccount   AccountIdentification `json:"debtor_account"`
	Reference       string                `json:"entry_reference,omitempty"`
	Amount          Amount                `json:"transaction_amount"`
	Direction       string                `json:"credit_debit_indicator"`
	Status          string                `json:"status"`
	BookingDate     string                `json:"booking_date,omitempty"`
	ValueDate       string                `json:"value_date,omitempty"`
	Creditor        Party                 `json:"creditor"`
	Debtor          Party                 `json:"debtor"`
	Remittance      []string              `json:"remittance_information,omitempty"`
}
type Account struct {
	UID                string `json:"uid,omitempty"`
	IdentificationHash string `json:"identification_hash"`
	Name               string `json:"name"`
	Details            string `json:"details"`
	Currency           string `json:"currency"`
	AccountID          struct {
		IBAN string `json:"iban"`
	} `json:"account_id"`
}
type AccountData struct {
	Account      Account       `json:"account"`
	Balances     []Balance     `json:"balances"`
	Transactions []Transaction `json:"transactions"`
}
type Access struct {
	ValidUntil time.Time `json:"valid_until"`
}
type Session struct {
	ID       string    `json:"session_id"`
	Accounts []Account `json:"accounts"`
	Access   Access    `json:"access"`
	ASPSP    struct {
		Name    string `json:"name"`
		Country string `json:"country"`
	} `json:"aspsp"`
}

func FromEnv() (*Client, error) {
	cfg := Config{os.Getenv("EB_APPLICATION_ID"), os.Getenv("EB_PRIVATE_KEY_PATH"), os.Getenv("EB_REDIRECT_URL")}
	if cfg.AppID == "" && cfg.KeyPath == "" && cfg.RedirectURL == "" {
		return nil, nil
	}
	return New(cfg, nil)
}
func New(cfg Config, transport http.RoundTripper) (*Client, error) {
	if cfg.AppID == "" || cfg.KeyPath == "" || cfg.RedirectURL == "" {
		return nil, errors.New("set EB_APPLICATION_ID, EB_PRIVATE_KEY_PATH and EB_REDIRECT_URL together")
	}
	u, err := url.Parse(cfg.RedirectURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != CallbackPath {
		return nil, errors.New("EB_REDIRECT_URL must end in /api/banking/callback without query or fragment")
	}
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, errors.New("EB_REDIRECT_URL needs HTTPS, or HTTP on localhost for development")
	}
	contents, err := os.ReadFile(cfg.KeyPath)
	if err != nil {
		return nil, errors.New("cannot read EB_PRIVATE_KEY_PATH")
	}
	block, _ := pem.Decode(contents)
	if block == nil {
		return nil, errors.New("EB private key must be PEM encoded")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		parsed, e := x509.ParsePKCS8PrivateKey(block.Bytes)
		if e != nil {
			return nil, errors.New("EB private key must be an unencrypted RSA PKCS1 or PKCS8 key")
		}
		key, _ = parsed.(*rsa.PrivateKey)
	}
	if key == nil || key.N.BitLen() < 2048 {
		return nil, errors.New("EB requires an RSA private key of at least 2048 bits")
	}
	if err := key.Validate(); err != nil {
		return nil, errors.New("invalid EB RSA private key")
	}
	return &Client{cfg, key, &http.Client{Timeout: 12 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) RedirectURL() string   { return c.config.RedirectURL }
func (c *Client) ApplicationID() string { return c.config.AppID }
func (c *Client) token() (string, error) {
	header, _ := json.Marshal(map[string]string{"typ": "JWT", "alg": "RS256", "kid": c.config.AppID})
	now := time.Now().Unix()
	payload, _ := json.Marshal(map[string]any{"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + 300})
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	hash := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.key, crypto.SHA256, hash[:])
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature), err
}
func (c *Client) call(ctx context.Context, method, path string, body, out any) error {
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	jwt, err := c.token()
	if err != nil {
		return problem("Could not sign the Enable Banking request")
	}
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		return problem("Enable Banking did not respond. Please try again.")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		// EB may report lost account access as HTTP 400 with a nested ASPSP
		// error. Inspect only recognized codes; never expose provider text.
		var failure struct {
			Error  string          `json:"error"`
			Detail json.RawMessage `json:"detail"`
		}
		if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&failure) == nil {
			switch failure.Error {
			case "EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST":
				return &Error{410, "This bank session is no longer available. Reconnect the test bank."}
			case "ACCOUNT_DOES_NOT_EXIST", "ASPSP_ACCOUNT_NOT_ACCESSIBLE":
				return accountAccessError()
			case "ASPSP_ERROR":
				var detail struct {
					Message string `json:"message"`
				}
				if strings.HasPrefix(path, "/accounts/") && json.Unmarshal(failure.Detail, &detail) == nil && detail.Message == "Forbidden, authenticated but access to resource is not allowed" {
					return accountAccessError()
				}
			}
		}
		switch res.StatusCode {
		case 401, 403:
			return &Error{502, "Enable Banking rejected access. Check the application or reconnect an expired session."}
		case 404, 410:
			return &Error{410, "This bank session is no longer available. Reconnect the test bank."}
		case 429:
			return &Error{429, "Enable Banking is rate limiting requests. Wait before refreshing again."}
		default:
			return problem("Enable Banking could not complete the request. Please try again.")
		}
	}
	if out == nil {
		return nil
	}
	data, err = io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
	if err != nil || len(data) > 8<<20 || json.Unmarshal(data, out) != nil {
		return problem("Enable Banking returned an unreadable response")
	}
	return nil
}

func accountAccessError() error {
	return &Error{410, "The test bank no longer allows access to these accounts. Use Connect test bank again and select the current mock accounts. Your imported history is kept."}
}

// The endpoint is identical for live and sandbox apps. Verify the application,
// rather than trusting a local environment flag to keep this slice sandbox-only.
func (c *Client) CheckSandbox(ctx context.Context) error {
	var app struct {
		Environment string   `json:"environment"`
		Active      bool     `json:"active"`
		Redirects   []string `json:"redirect_urls"`
	}
	if err := c.call(ctx, "GET", "/application", nil, &app); err != nil {
		return err
	}
	if app.Environment != "SANDBOX" {
		return &Error{409, "This Haven connection supports sandbox applications only"}
	}
	if !app.Active {
		return &Error{409, "Activate the Enable Banking sandbox application first"}
	}
	if !slices.Contains(app.Redirects, c.config.RedirectURL) {
		return &Error{409, "Register the exact EB_REDIRECT_URL in your Enable Banking application"}
	}
	return nil
}
func (c *Client) Banks(ctx context.Context) ([]Bank, error) {
	if err := c.CheckSandbox(ctx); err != nil {
		return nil, err
	}
	var result struct {
		Banks []Bank `json:"aspsps"`
	}
	if err := c.call(ctx, "GET", "/aspsps?country=LT", nil, &result); err != nil {
		return nil, err
	}
	banks := []Bank{}
	for _, b := range result.Banks {
		if b.Country == "LT" && slices.Contains(b.PSUTypes, "personal") {
			banks = append(banks, b)
		}
	}
	return banks, nil
}
// Logo downloads the logo Enable Banking lists for a bank. It returns no data
// and no error when the bank has no logo.
func (c *Client) Logo(ctx context.Context, name, country string) ([]byte, string, error) {
	var result struct {
		Banks []Bank `json:"aspsps"`
	}
	if err := c.call(ctx, "GET", "/aspsps?country="+url.QueryEscape(country), nil, &result); err != nil {
		return nil, "", err
	}
	for _, bank := range result.Banks {
		if bank.Name == name && bank.Country == country && bank.Logo != "" {
			return fetchImage(ctx, c.http, bank.Logo)
		}
	}
	return nil, "", nil
}

const maxLogoBytes = 512 << 10

// fetchImage accepts only an https image of at most 512 KB.
func fetchImage(ctx context.Context, client *http.Client, raw string) ([]byte, string, error) {
	address, err := url.Parse(raw)
	if err != nil || address.Scheme != "https" || address.Host == "" {
		return nil, "", problem("The bank logo address is not usable")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", address.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "image/*")
	res, err := client.Do(req)
	if err != nil {
		return nil, "", problem("The bank logo could not be downloaded")
	}
	defer res.Body.Close()
	kind := strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0])
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(kind, "image/") {
		return nil, "", problem("The bank logo could not be downloaded")
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxLogoBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxLogoBytes {
		return nil, "", problem("The bank logo could not be downloaded")
	}
	return data, kind, nil
}

func (c *Client) Authorize(ctx context.Context, bank Bank, state string) (string, error) {
	seconds := min(bank.MaxConsent, int64(30*24*60*60))
	if seconds <= 0 {
		return "", problem("This test bank has no usable consent period")
	}
	body := map[string]any{"access": map[string]any{"valid_until": time.Now().UTC().Add(time.Duration(seconds) * time.Second).Format(time.RFC3339), "balances": true, "transactions": true}, "aspsp": map[string]string{"name": bank.Name, "country": bank.Country}, "state": state, "redirect_url": c.config.RedirectURL, "psu_type": "personal"}
	var result struct {
		URL string `json:"url"`
	}
	if err := c.call(ctx, "POST", "/auth", body, &result); err != nil {
		return "", err
	}
	u, err := url.Parse(result.URL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return "", problem("Enable Banking returned an invalid authorization URL")
	}
	return result.URL, nil
}
func (c *Client) Exchange(ctx context.Context, code string) (Session, error) {
	var session Session
	if err := c.CheckSandbox(ctx); err != nil {
		return session, err
	}
	err := c.call(ctx, "POST", "/sessions", map[string]string{"code": code}, &session)
	if err == nil && (session.ID == "" || !session.Access.ValidUntil.After(time.Now()) || len(session.Accounts) > 20) {
		err = problem("Enable Banking returned an invalid or oversized test session")
	}
	return session, err
}
func (c *Client) Snapshot(ctx context.Context, session Session) ([]AccountData, error) {
	if err := c.CheckSandbox(ctx); err != nil {
		return nil, err
	}
	snapshot := []AccountData{}
	for _, account := range session.Accounts {
		item := AccountData{Account: account, Balances: []Balance{}, Transactions: []Transaction{}}
		if account.UID == "" {
			snapshot = append(snapshot, item)
			continue
		}
		path := "/accounts/" + url.PathEscape(account.UID)
		var balances struct {
			Balances []Balance `json:"balances"`
		}
		if err := c.call(ctx, "GET", path+"/balances", nil, &balances); err != nil {
			return nil, err
		}
		if balances.Balances != nil {
			item.Balances = balances.Balances
		}
		continuation := ""
		seen := map[string]bool{}
		for page := 0; ; page++ {
			if page >= 100 {
				return nil, problem("The test bank returned too many pages; the previous snapshot was kept")
			}
			query := url.Values{}
			if continuation != "" {
				query.Set("continuation_key", continuation)
			}
			var result struct {
				Transactions []Transaction `json:"transactions"`
				Next         string        `json:"continuation_key"`
			}
			if err := c.call(ctx, "GET", path+"/transactions?"+query.Encode(), nil, &result); err != nil {
				return nil, err
			}
			item.Transactions = append(item.Transactions, result.Transactions...)
			if len(item.Transactions) > 10000 {
				return nil, problem("The test bank returned too many transactions; the previous snapshot was kept")
			}
			if result.Next == "" {
				break
			}
			if seen[result.Next] {
				return nil, problem("The test bank repeated a page; the previous snapshot was kept")
			}
			seen[result.Next] = true
			continuation = result.Next
		}
		snapshot = append(snapshot, item)
	}
	return snapshot, nil
}
func (c *Client) Disconnect(ctx context.Context, id string) error {
	if err := c.CheckSandbox(ctx); err != nil {
		return err
	}
	err := c.call(ctx, "DELETE", "/sessions/"+url.PathEscape(id), nil, nil)
	var e *Error
	if errors.As(err, &e) && e.Status == 410 {
		return nil
	}
	return err
}
func RandomToken() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func Hash(value string) string { sum := sha256.Sum256([]byte(value)); return fmt.Sprintf("%x", sum) }
func ValidState(value string) bool {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	return err == nil && len(raw) == 32 && !strings.ContainsAny(value, " \r\n")
}
