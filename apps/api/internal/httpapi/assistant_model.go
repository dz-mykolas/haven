package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

func (s Server) saveModel(w http.ResponseWriter, r *http.Request) {
	var body assistant.ProviderUpdate
	if !decode(w, r, &body) {
		return
	}
	saved, err := s.Store.SaveAssistantProvider(r.Context(), body)
	if err != nil {
		fail(w, err)
		return
	}
	write(w, 200, saved)
}
func (s Server) removeModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int64 `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.Store.RemoveAssistantProvider(r.Context(), body.Version); err != nil {
		fail(w, err)
		return
	}
	s.assistantStatus(w, r)
}
func (s Server) modelAllowed(w http.ResponseWriter, r *http.Request) (assistant.Settings, bool) {
	settings, err := s.Store.AssistantSettings(r.Context())
	if err != nil {
		fail(w, err)
		return settings, false
	}
	if settings.Mode == "manual" {
		write(w, 403, map[string]string{"error": "Turn on the assistant before sending a model request"})
		return settings, false
	}
	if err = settings.Validate(); err != nil {
		write(w, 403, map[string]string{"error": "Assistant preferences are invalid"})
		return settings, false
	}
	return settings, true
}
func modelError(w http.ResponseWriter, err error) {
	status := 502
	message := err.Error()
	if errors.Is(err, context.DeadlineExceeded) {
		status = 504
		message = "The model took too long to respond. Try again or use a faster model"
	}
	if errors.Is(err, context.Canceled) {
		status = 408
		message = "Model request cancelled"
	}
	write(w, status, map[string]string{"error": message})
}
func (s Server) testModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Version int64 `json:"version"`
	}
	if !decode(w, r, &body) {
		return
	}
	settings, ok := s.modelAllowed(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 80*time.Second)
	defer cancel()
	config, key, err := s.Store.ProviderCredentials(ctx)
	if err != nil {
		modelError(w, err)
		return
	}
	if config.Version != body.Version {
		write(w, 409, map[string]string{"error": "Connection changed. Reload settings before testing"})
		return
	}
	if config.BaseURL == "" || config.Model == "" {
		write(w, 400, map[string]string{"error": "Save a model connection first"})
		return
	}
	_, err = assistant.Complete(ctx, config, key, "This is a connection test. Reply only with OK.", []assistant.Message{{Role: "user", Content: "Reply with OK."}})
	latest, loadErr := s.Store.AssistantSettings(ctx)
	if loadErr != nil {
		fail(w, loadErr)
		return
	}
	if latest.Mode == "manual" || latest.Version != settings.Version {
		write(w, 409, map[string]string{"error": "Assistant preferences changed during the test. Test again"})
		return
	}
	if markErr := s.Store.MarkProviderTest(ctx, config.Version, err == nil); markErr != nil {
		fail(w, markErr)
		return
	}
	if err != nil {
		modelError(w, err)
		return
	}
	s.assistantStatus(w, r)
}
func (s Server) chat(w http.ResponseWriter, r *http.Request) {
	var body assistant.ChatRequest
	if !decode(w, r, &body) {
		return
	}
	if err := body.Validate(); err != nil {
		write(w, 400, map[string]string{"error": err.Error()})
		return
	}
	settings, ok := s.modelAllowed(w, r)
	if !ok {
		return
	}
	gate := ""
	for _, skill := range assistant.Catalog() {
		if settings.Skills[skill.ID] {
			gate = skill.ID
			break
		}
	}
	if gate == "" {
		write(w, 403, map[string]string{"error": "Enable at least one skill to chat"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 80*time.Second)
	defer cancel()
	var reply assistant.ChatReply
	err := assistant.Run(ctx, s.Store, gate, "chat", func(ctx context.Context, in assistant.Invocation) error {
		config, key, err := s.Store.ProviderCredentials(ctx)
		if err != nil {
			return err
		}
		if config.BaseURL == "" || config.Model == "" {
			return errors.New("Add a model connection in Assistant preferences")
		}
		snapshot, err := s.Store.Snapshot(ctx, time.Now().Format("2006-01"))
		if err != nil {
			return errors.New("Could not load context for this request")
		}
		tasks := []domain.Task{}
		entries := []domain.Entry{}
		categories := []domain.Category{}
		tags := []string{}
		if in.Settings.Skills["plan-task"] {
			for _, task := range snapshot.Tasks {
				if !task.Done {
					tasks = append(tasks, task)
					if len(tasks) == 100 {
						break
					}
				}
			}
		}
		if in.Settings.Skills["plan-task"] {
			drafts, err := assistant.ResolveTaskDrafts(body.TaskDrafts, snapshot.Tasks)
			if err != nil {
				return err
			}
			for _, draft := range drafts {
				replaced := false
				for i := range tasks {
					if tasks[i].ID == draft.ID {
						tasks[i] = draft
						replaced = true
						break
					}
				}
				if !replaced {
					tasks = append(tasks, draft)
				}
			}
		} else if len(body.TaskDrafts) > 0 {
			return errors.New("Enable task planning before continuing a task draft")
		}
		if in.Settings.Skills["review-transaction"] || in.Settings.Skills["organize-money"] {
			for _, id := range body.EntryIDs {
				found := false
				for _, entry := range snapshot.Entries {
					if entry.ID == id {
						entries = append(entries, entry)
						found = true
						break
					}
				}
				if !found {
					return errors.New("An attached transaction is no longer available. Select it again")
				}
			}
			categories = snapshot.Categories
			tags = snapshot.Tags
		} else if len(body.EntryIDs) > 0 {
			return errors.New("Enable a Money skill before attaching transactions")
		}
		prompt := assistant.ChatPrompt(in.Settings, body.Timezone, tasks, entries, categories, tags, assistant.ReviewHistory(entries, snapshot.Entries))
		output, err := assistant.Complete(ctx, config, key, prompt, body.Messages)
		if err != nil {
			return err
		}
		latest, err := s.Store.AssistantProvider(ctx)
		if err != nil {
			return errors.New("Could not verify model connection")
		}
		if latest.Version != config.Version {
			return errors.New("Model connection changed. Send your message again")
		}
		reply, err = assistant.ParseReply(output, in.Settings, body.Timezone, tasks, entries, categories)
		return err
	})
	if err != nil {
		modelError(w, err)
		return
	}
	write(w, 200, reply)
}
