package httpapi

import (
	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"net/http"
)

type AssistantStatus struct {
	Settings       assistant.Settings `json:"settings"`
	Skills         []assistant.Skill  `json:"skills"`
	Provider       assistant.Provider `json:"provider"`
	ModelConnected bool               `json:"model_connected"`
}

func (s Server) assistantStatus(w http.ResponseWriter, r *http.Request) {
	settings, err := s.Store.AssistantSettings(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	provider, err := s.Store.AssistantProvider(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, AssistantStatus{Settings: settings, Skills: assistant.Catalog(), Provider: provider, ModelConnected: provider.TestedAt != nil})
}
func (s Server) assistantSettings(w http.ResponseWriter, r *http.Request) {
	var settings assistant.Settings
	if !decode(w, r, &settings) {
		return
	}
	saved, err := s.Store.SaveAssistantSettings(r.Context(), settings)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, saved)
}
