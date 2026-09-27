package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/banking"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
)

type Server struct {
	Store   *store.Store
	Banking *banking.Client
}

func write(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, err error) {
	var bankError *banking.Error
	if errors.As(err, &bankError) {
		write(w, bankError.Status, map[string]string{"error": bankError.Message})
		return
	}
	var e *store.Error
	if errors.As(err, &e) {
		write(w, e.Status, map[string]string{"error": e.Message})
		return
	}
	slog.Error("request failed", "error", err)
	write(w, 500, map[string]string{"error": "Couldn't save or load your data. Please try again."})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/json" {
		write(w, 415, map[string]string{"error": "Use application/json"})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		write(w, 400, map[string]string{"error": "Invalid request fields"})
		return false
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		write(w, 400, map[string]string{"error": "Send one JSON object"})
		return false
	}
	return true
}
func New(s *store.Store, origins []string, clients ...*banking.Client) http.Handler {
	api := Server{Store: s}
	if len(clients) > 0 {
		api.Banking = clients[0]
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Pool.Ping(r.Context()); err != nil {
			fail(w, err)
			return
		}
		write(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/state", api.state)
	mux.HandleFunc("GET /api/entries", api.activity)
	mux.HandleFunc("GET /api/assistant", api.assistantStatus)
	mux.HandleFunc("PUT /api/assistant/settings", api.assistantSettings)
	mux.HandleFunc("PUT /api/assistant/provider", api.saveModel)
	mux.HandleFunc("DELETE /api/assistant/provider", api.removeModel)
	mux.HandleFunc("POST /api/assistant/provider/test", api.testModel)
	mux.HandleFunc("POST /api/assistant/chat", api.chat)
	mux.HandleFunc("GET /api/assistant/inbox", api.reviewInbox)
	mux.HandleFunc("POST /api/assistant/inbox/retry", api.retryReviews)
	mux.HandleFunc("POST /api/assistant/inbox/{id}/dismiss", api.dismissReview)
	mux.HandleFunc("POST /api/assistant/inbox/{id}/apply", api.applyReview)
	mux.HandleFunc("POST /api/assistant/inbox/{id}/undo", api.undoClassification)
	mux.HandleFunc("POST /api/assistant/inbox/{id}/answer", api.answerReview)
	mux.HandleFunc("PUT /api/categories/{id}", api.category)
	mux.HandleFunc("PUT /api/banking/transactions/{id}/annotations", api.annotations)
	mux.HandleFunc("PUT /api/accounts/{id}", api.account)
	mux.HandleFunc("DELETE /api/accounts/{id}", api.removeAccount)
	mux.HandleFunc("GET /api/accounts/{id}/logo", api.accountLogo)
	mux.HandleFunc("GET /api/icons", api.brandIcon)
	mux.HandleFunc("PUT /api/entries/{id}", api.entry)
	mux.HandleFunc("PUT /api/tasks/{id}", api.task)
	mux.HandleFunc("GET /api/tasks/calendar", api.taskCalendar)
	mux.HandleFunc("POST /api/tasks/{id}/complete", api.complete)
	mux.HandleFunc("GET /api/tasks/followups", api.followUps)
	mux.HandleFunc("POST /api/tasks/followups/{id}/seen", api.followUpAction(seeFollowUp))
	mux.HandleFunc("POST /api/tasks/followups/{id}/undo", api.followUpAction(undoFollowUp))
	mux.HandleFunc("POST /api/tasks/followups/{id}/answer", api.followUpAction(answerFollowUp))
	mux.HandleFunc("POST /api/tasks/followups/{id}/accept", api.followUpAction(acceptFollowUp))
	mux.HandleFunc("POST /api/tasks/followups/{id}/dismiss", api.followUpAction(dismissFollowUp))
	mux.HandleFunc("GET /api/export", api.export)
	mux.HandleFunc("GET /api/banking", api.bankStatus)
	mux.HandleFunc("GET /api/banking/banks", api.banks)
	mux.HandleFunc("POST /api/banking/authorize", api.bankStart)
	mux.HandleFunc("GET /api/banking/callback", api.bankCallback)
	mux.HandleFunc("POST /api/banking/connections/{id}/refresh", api.bankRefresh)
	mux.HandleFunc("POST /api/banking/connections/{id}/disconnect", api.bankDisconnect)
	allowed := map[string]bool{}
	hosts := map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}
	for _, origin := range origins {
		allowed[origin] = true
		if u, err := url.Parse(origin); err == nil && u.Hostname() != "" {
			hosts[u.Hostname()] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		origin := r.Header.Get("Origin")
		// Only this browser redirect may arrive cross-site; its handler requires
		// an expiring, one-use state tied to an HttpOnly browser cookie.
		callback := r.Method == "GET" && r.URL.Path == banking.CallbackPath
		if !hosts[host] || (!callback && ((origin != "" && !allowed[origin]) || (r.Header.Get("Sec-Fetch-Site") == "cross-site" && origin == ""))) {
			write(w, 403, map[string]string{"error": "Origin not allowed"})
			return
		}
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(204)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (s Server) state(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if month == "" {
		month = time.Now().UTC().Format("2006-01")
	}
	if !domain.ValidMonth(month) {
		write(w, 400, map[string]string{"error": "Invalid reporting month"})
		return
	}
	data, err := s.Store.Snapshot(r.Context(), month)
	if err != nil {
		fail(w, err)
		return
	}
	timezone := r.URL.Query().Get("timezone")
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil || timezone == "Local" {
		write(w, 400, map[string]string{"error": "Choose a valid timezone"})
		return
	}
	upcoming := domain.Upcoming(data.Tasks, time.Now().In(location).Format("2006-01-02"))
	data.Upcoming = &upcoming
	switch r.URL.Query().Get("entries") {
	case "preview":
		if len(data.Entries) > 200 {
			data.Entries = data.Entries[:200]
		}
	case "", "all":
	default:
		write(w, 400, map[string]string{"error": "Choose all or preview entries"})
		return
	}
	write(w, 200, data)
}
func match(w http.ResponseWriter, r *http.Request, id string) bool {
	if id != r.PathValue("id") {
		write(w, 400, map[string]string{"error": "ID must match the URL"})
		return false
	}
	return true
}
func (s Server) account(w http.ResponseWriter, r *http.Request) {
	var a domain.Account
	if !decode(w, r, &a) || !match(w, r, a.ID) {
		return
	}
	saved, err := s.Store.SaveAccount(r.Context(), a)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, saved)
}
func (s Server) entry(w http.ResponseWriter, r *http.Request) {
	var e domain.Entry
	if !decode(w, r, &e) || !match(w, r, e.ID) {
		return
	}
	saved, err := s.Store.SaveEntry(r.Context(), e)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, saved)
}
func (s Server) task(w http.ResponseWriter, r *http.Request) {
	var t domain.Task
	if !decode(w, r, &t) || !match(w, r, t.ID) {
		return
	}
	saved, err := s.Store.SaveTask(r.Context(), t)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, saved)
}

type CompleteRequest struct {
	ID      string `json:"id"`
	Version int64  `json:"version"`
}

func (s Server) complete(w http.ResponseWriter, r *http.Request) {
	var body CompleteRequest
	if !decode(w, r, &body) {
		return
	}
	t, err := s.Store.CompleteTask(r.Context(), r.PathValue("id"), body.ID, body.Version)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, t)
}
func (s Server) export(w http.ResponseWriter, r *http.Request) {
	b, err := s.Store.Backup(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="haven-`+strings.ReplaceAll(b.ExportedAt.Format("2006-01-02"), "\"", "")+`.json"`)
	write(w, 200, b)
}

func (s Server) removeAccount(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int64 `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.RemoveAccount(r.Context(), r.PathValue("id"), body.Version); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"removed": true})
}

func (s Server) taskCalendar(w http.ResponseWriter, r *http.Request) {
	month := r.URL.Query().Get("month")
	if !domain.ValidMonth(month) {
		write(w, 400, map[string]string{"error": "Choose a valid calendar month"})
		return
	}
	result, err := s.Store.TaskCalendar(r.Context(), month)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, result)
}
