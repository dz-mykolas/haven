package httpapi

import "net/http"

func (s Server) followUps(w http.ResponseWriter, r *http.Request) {
	events, err := s.Store.FollowUpEvents(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, map[string]any{"items": events})
}
func (s Server) followUpAction(action func(Server, *http.Request, string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Answer string `json:"answer,omitempty"`
		}
		if !decode(w, r, &body) {
			return
		}
		if err := action(s, r, body.Answer); err != nil {
			fail(w, err)
			return
		}
		write(w, 200, map[string]bool{"ok": true})
	}
}
func seeFollowUp(s Server, r *http.Request, _ string) error {
	return s.Store.SeeFollowUp(r.Context(), r.PathValue("id"))
}
func undoFollowUp(s Server, r *http.Request, _ string) error {
	return s.Store.UndoFollowUp(r.Context(), r.PathValue("id"))
}
func answerFollowUp(s Server, r *http.Request, answer string) error {
	return s.Store.AnswerFollowUp(r.Context(), r.PathValue("id"), answer)
}
func acceptFollowUp(s Server, r *http.Request, _ string) error {
	return s.Store.AcceptFollowUp(r.Context(), r.PathValue("id"))
}
func dismissFollowUp(s Server, r *http.Request, _ string) error {
	return s.Store.DismissFollowUp(r.Context(), r.PathValue("id"))
}
