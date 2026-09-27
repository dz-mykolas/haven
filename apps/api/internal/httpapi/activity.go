package httpapi

import (
	"net/http"
	"unicode/utf8"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
)

func (s Server) activity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := store.ActivityFilter{Month: q.Get("month"), Account: q.Get("account"), Category: q.Get("category"), Tag: q.Get("tag"), Search: q.Get("search"), Payment: q.Get("payment"), Unlinked: q.Get("unlinked") == "true"}
	if (filter.Month != "" && !domain.ValidMonth(filter.Month)) || (filter.Account != "" && !domain.ValidID(filter.Account)) || (filter.Category != "" && filter.Category != "uncategorized" && !domain.ValidID(filter.Category)) || (filter.Payment != "" && !domain.ValidID(filter.Payment)) || utf8.RuneCountInString(filter.Search) > 200 || utf8.RuneCountInString(filter.Tag) > 100 || (q.Get("unlinked") != "" && q.Get("unlinked") != "true" && q.Get("unlinked") != "false") {
		write(w, 400, map[string]string{"error": "Invalid transaction filters"})
		return
	}
	page, err := s.Store.Activity(r.Context(), filter, q.Get("cursor"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, page)
}
