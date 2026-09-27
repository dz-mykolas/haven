package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
)

const bankCookie = "haven_bank_authorization"

func (s Server) bankStatus(w http.ResponseWriter, r *http.Request) {
	connections, err := s.Store.BankConnections(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"configured": s.Banking != nil, "environment": "SANDBOX", "connections": connections})
}
func (s Server) requireBank(w http.ResponseWriter) bool {
	if s.Banking == nil {
		write(w, 503, map[string]string{"error": "Enable Banking sandbox setup is not complete. Configure the application ID, private-key path, and callback URL."})
		return false
	}
	return true
}
func (s Server) banks(w http.ResponseWriter, r *http.Request) {
	if !s.requireBank(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	banks, err := s.Banking.Banks(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"banks": banks})
}
func (s Server) bankStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireBank(w) {
		return
	}
	var body struct {
		Name    string `json:"name"`
		Country string `json:"country"`
	}
	if !decode(w, r, &body) {
		return
	}
	redirect, _ := url.Parse(s.Banking.RedirectURL())
	// The state cookie must return to the same browser origin. localhost and
	// 127.0.0.1 are different cookie hosts, even though both reach the same app.
	if r.Host != redirect.Host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != redirect.Scheme+"://"+redirect.Host) {
		write(w, 409, map[string]string{"error": "Open Haven at the same host and port as EB_REDIRECT_URL before connecting."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	banks, err := s.Banking.Banks(ctx)
	if err != nil {
		fail(w, err)
		return
	}
	var selected *banking.Bank
	for _, bank := range banks {
		if bank.Name == body.Name && bank.Country == body.Country {
			selected = &bank
			break
		}
	}
	if selected == nil {
		write(w, 400, map[string]string{"error": "Choose an available Lithuanian personal test bank"})
		return
	}
	state, browser := banking.RandomToken(), banking.RandomToken()
	destination, err := s.Banking.Authorize(ctx, *selected, state)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.Store.BeginBankAuth(ctx, state, browser, s.Banking.ApplicationID(), *selected); err != nil {
		fail(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: bankCookie, Value: browser, Path: banking.CallbackPath, HttpOnly: true, Secure: redirect.Scheme == "https", SameSite: http.SameSiteLaxMode, MaxAge: 600})
	write(w, 200, map[string]string{"url": destination})
}
func (s Server) bankCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Referrer-Policy", "no-referrer")
	if !s.requireBank(w) {
		return
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie(bankCookie)
	if err != nil || !banking.ValidState(state) || !banking.ValidState(cookie.Value) {
		write(w, 400, map[string]string{"error": "Invalid bank authorization. Return to Haven and connect again."})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	bank, err := s.Store.ConsumeBankAuth(ctx, state, cookie.Value, s.Banking.ApplicationID())
	if err != nil {
		fail(w, err)
		return
	}
	redirect, _ := url.Parse(s.Banking.RedirectURL())
	http.SetCookie(w, &http.Cookie{Name: bankCookie, Path: banking.CallbackPath, HttpOnly: true, Secure: redirect.Scheme == "https", SameSite: http.SameSiteLaxMode, MaxAge: -1})
	finish := func(status, id string) {
		q := url.Values{"banking": {status}}
		if id != "" {
			q.Set("connection", id)
		}
		http.Redirect(w, r, "/?"+q.Encode()+"#money", http.StatusSeeOther)
	}
	if r.URL.Query().Get("error") != "" {
		finish("cancelled", "")
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" || len(code) > 4096 {
		finish("failed", "")
		return
	}
	session, err := s.Banking.Exchange(ctx, code)
	if err != nil {
		finish("failed", "")
		return
	}
	if session.ASPSP.Name != bank.Name || session.ASPSP.Country != bank.Country {
		finish("failed", "")
		return
	}
	id, err := s.Store.SaveBankSession(ctx, s.Banking.ApplicationID(), session)
	if err != nil {
		// Best effort cleanup if storage failed after the remote session was created.
		_ = s.Banking.Disconnect(ctx, session.ID)
		finish("failed", "")
		return
	}
	finish("connected", id)
}
func (s Server) bankRefresh(w http.ResponseWriter, r *http.Request)    { s.bankUpdate(w, r, false) }
func (s Server) bankDisconnect(w http.ResponseWriter, r *http.Request) { s.bankUpdate(w, r, true) }
func (s Server) bankUpdate(w http.ResponseWriter, r *http.Request, disconnect bool) {
	if !s.requireBank(w) {
		return
	}
	var body struct{}
	if !decode(w, r, &body) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 22*time.Second)
	defer cancel()
	err := s.Store.UpdateBankConnection(ctx, r.PathValue("id"), s.Banking.ApplicationID(), disconnect, s.Banking)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			write(w, 504, map[string]string{"error": "The bank request timed out. The previous snapshot was kept; try again."})
			return
		}
		fail(w, err)
		return
	}
	s.bankStatus(w, r)
}
