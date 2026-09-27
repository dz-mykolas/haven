package httpapi

import (
	"net/http"

	"github.com/dz-mykolas/haven/apps/api/internal/store"
)

func (s Server) reviewInbox(w http.ResponseWriter, r *http.Request) {
	view := r.URL.Query().Get("view")
	if view != "" && view != "review" && view != "history" {
		write(w, 400, map[string]string{"error": "Choose To review or History"})
		return
	}
	inbox, err := s.Store.ReviewInbox(r.Context(), view == "history", r.URL.Query().Get("cursor"))
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, inbox)
}
func (s Server) dismissReview(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.DismissReview(r.Context(), r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"dismissed": true})
}
func (s Server) retryReviews(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.RetryReviews(r.Context()); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"queued": true})
}
func (s Server) undoClassification(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.UndoClassification(r.Context(), r.PathValue("id")); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"undone": true})
}
func (s Server) answerReview(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Answer string `json:"answer"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.AnswerReview(r.Context(), r.PathValue("id"), body.Answer); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"queued": true})
}
func (s Server) applyReview(w http.ResponseWriter, r *http.Request) {
	var body store.BankAnnotations
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.ApplyReview(r.Context(), r.PathValue("id"), body); err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]bool{"saved": true})
}
