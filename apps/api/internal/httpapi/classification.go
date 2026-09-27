package httpapi

import (
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/dz-mykolas/haven/apps/api/internal/store"
	"net/http"
)

func (s Server) category(w http.ResponseWriter, r *http.Request) {
	var c domain.Category
	if !decode(w, r, &c) || !match(w, r, c.ID) {
		return
	}
	result, err := s.Store.SaveCategory(r.Context(), c)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, result)
}
func (s Server) annotations(w http.ResponseWriter, r *http.Request) {
	var a store.BankAnnotations
	if !decode(w, r, &a) {
		return
	}
	result, err := s.Store.SaveBankAnnotations(r.Context(), r.PathValue("id"), a)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, result)
}
