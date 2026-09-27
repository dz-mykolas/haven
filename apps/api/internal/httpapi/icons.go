package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/brands"
)

// brandIcon matches a payee or plan name to a Simple Icons brand. Everything
// is embedded, so no outside service learns which merchants are looked up.
func (a Server) brandIcon(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" || len(name) > 200 {
		write(w, 400, map[string]string{"error": "Provide a name of up to 200 characters"})
		return
	}
	icon, ok := brands.Match(name)
	if !ok {
		write(w, 404, map[string]string{"error": "No icon for this name"})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=604800")
	_ = json.NewEncoder(w).Encode(icon)
}

const noLogoRetry = 7 * 24 * time.Hour

// accountLogo serves a bank account's logo from Haven's own cache. The first
// request downloads it from the address Enable Banking lists for the bank.
func (a Server) accountLogo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	name, country, err := a.Store.AccountBank(ctx, r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	logo, cached, err := a.Store.CachedBankLogo(ctx, name, country)
	if err != nil {
		fail(w, err)
		return
	}
	stale := !cached || (len(logo.Data) == 0 && time.Since(logo.FetchedAt) > noLogoRetry)
	if stale && a.Banking != nil {
		data, kind, err := a.Banking.Logo(ctx, name, country)
		if err != nil {
			// A failed download is not remembered, so the next request retries.
			slog.Warn("bank logo unavailable", "bank", name, "error", err)
		} else if err := a.Store.SaveBankLogo(ctx, name, country, data, kind); err != nil {
			fail(w, err)
			return
		} else {
			logo.Data, logo.ContentType = data, kind
		}
	}
	if len(logo.Data) == 0 {
		write(w, 404, map[string]string{"error": "This bank has no logo"})
		return
	}
	w.Header().Set("Content-Type", logo.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	// Logos may be SVG: never let one run script or load anything.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	_, _ = w.Write(logo.Data)
}
