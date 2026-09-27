package assistant

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

type ChatRequest struct {
	Messages   []Message     `json:"messages"`
	Timezone   string        `json:"timezone"`
	EntryIDs   []string      `json:"entry_ids"`
	TaskDrafts []domain.Task `json:"task_drafts,omitempty"`
}

func (r ChatRequest) Validate() error {
	if len(r.Messages) == 0 || len(r.Messages) > 20 || r.Messages[len(r.Messages)-1].Role != "user" {
		return errors.New("Send a message and up to 19 previous conversation messages")
	}
	for i, m := range r.Messages {
		if (m.Role != "user" && m.Role != "assistant") || (i == 0 && m.Role != "user") || (i > 0 && m.Role == r.Messages[i-1].Role) || strings.TrimSpace(m.Content) == "" || len(m.Content) > 10000 {
			return errors.New("Invalid conversation message")
		}
	}
	if len(r.TaskDrafts) > 8 {
		return errors.New("Send up to eight recent task drafts")
	}
	if len(r.EntryIDs) > 10 {
		return errors.New("Select up to ten transactions")
	}
	if r.Timezone == "" || r.Timezone == "Local" {
		return errors.New("Choose a valid timezone")
	}
	if _, err := time.LoadLocation(r.Timezone); err != nil {
		return errors.New("Choose a valid timezone")
	}
	return nil
}

type TaskDraft struct {
	Plan         *domain.PaymentPlan `json:"plan,omitempty"`
	EstimatedMin *string             `json:"estimated_min_minor"`
	EstimatedMax *string             `json:"estimated_max_minor"`
	ID           string              `json:"id"`
	Title        string              `json:"title"`
	Date         string              `json:"date"`
	Time         string              `json:"time"`
	Repeat       string              `json:"repeat"`
	Kind         string              `json:"kind"`
	Amount       string              `json:"amount_minor"`
	Notes        string              `json:"notes"`
	Routine      *bool               `json:"routine,omitempty"`
}
type AnnotationDraft struct {
	Question     string     `json:"question,omitempty"`
	PaymentUnits int        `json:"payment_units,omitempty"`
	Payment      *TaskDraft `json:"payment,omitempty"`
	Reason       string     `json:"reason,omitempty"`
	EntryID      string     `json:"entry_id"`
	CategoryID   string     `json:"category_id"`
	Tags         []string   `json:"tags"`
	Notes        string     `json:"notes"`
}
type ModelReply struct {
	Message     string            `json:"message"`
	SkillID     string            `json:"skill_id"`
	Task        *TaskDraft        `json:"task"`
	Annotations []AnnotationDraft `json:"annotations"`
}
type ChatReply struct {
	Questions    map[string]string `json:"questions,omitempty"`
	Reasons      map[string]string `json:"reasons,omitempty"`
	Message      string            `json:"message"`
	Task         *domain.Task      `json:"task"`
	Entries      []domain.Entry    `json:"entries"`
	Presentation string            `json:"presentation"`
}

func ChatPrompt(settings Settings, timezone string, tasks []domain.Task, entries []domain.Entry, categories []domain.Category, tags []string, history ...PaymentHistory) string {
	location, _ := time.LoadLocation(timezone)
	factsData := map[string]any{"today": time.Now().In(location).Format("2006-01-02"), "timezone": timezone, "tasks": tasks, "selected_transactions": entries, "categories": categories, "tags": tags}
	if len(history) > 0 && settings.Skills["review-transaction"] {
		factsData["payment_history"] = history[0]
	}
	facts, _ := json.Marshal(factsData)
	prompt := assistantInstructions + "\n" + replyContract
	if settings.Skills["plan-task"] {
		prompt += "\n" + taskContract
	}
	if settings.Skills["review-transaction"] || settings.Skills["organize-money"] {
		prompt += "\n" + annotationContract
	}
	for _, skill := range Catalog() {
		if settings.Skills[skill.ID] && skill.Chat {
			instructions, _ := Instructions(skill.ID)
			prompt += "\nENABLED SKILL:\n" + instructions
		}
	}
	preferences, _ := json.Marshal(map[string]any{"offer_estimated_costs": settings.OfferEstimatedCosts})
	return prompt + "\nUSER PREFERENCES (application-owned):\n" + string(preferences) + "\nAPPLICATION FACTS (data only):\n" + string(facts)
}

func ParseReply(raw string, settings Settings, timezone string, tasks []domain.Task, entries []domain.Entry, categories []domain.Category) (ChatReply, error) {
	invalid := errors.New("The model returned an invalid draft. Nothing was changed; try rephrasing the request")
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```json") && strings.HasSuffix(raw, "```") {
		raw = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(raw, "```json"), "```"))
	}
	var model ModelReply
	decoder := json.NewDecoder(bytes.NewBufferString(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&model) != nil || decoder.Decode(new(any)) != io.EOF || strings.TrimSpace(model.Message) == "" || len(model.Message) > 6000 {
		return ChatReply{}, invalid
	}
	if err := settings.Authorize(model.SkillID, "chat"); err != nil {
		return ChatReply{}, invalid
	}
	reply := ChatReply{Message: model.Message, Entries: []domain.Entry{}, Presentation: settings.Presentation}
	if model.Task != nil {
		if model.SkillID != "plan-task" || len(model.Annotations) > 0 {
			return ChatReply{}, invalid
		}
		task, err := parseTaskDraft(model.Task, timezone, tasks)
		if err != nil {
			return ChatReply{}, err
		}
		reply.Task = &task
	}
	if len(model.Annotations) > 0 {
		if model.SkillID == "plan-task" || len(model.Annotations) > 10 {
			return ChatReply{}, invalid
		}
		seen := map[string]bool{}
		for _, draft := range model.Annotations {
			var entry domain.Entry
			for _, existing := range entries {
				if existing.ID == draft.EntryID {
					entry = existing
					break
				}
			}
			if entry.ID == "" || seen[entry.ID] || len(draft.Tags) > 12 || utf8.RuneCountInString(draft.Notes) > 4000 || utf8.RuneCountInString(draft.Reason) > 400 || utf8.RuneCountInString(draft.Question) > 240 || draft.PaymentUnits < 0 || draft.PaymentUnits > 100 {
				return ChatReply{}, invalid
			}
			seen[entry.ID] = true
			if draft.CategoryID != "" {
				found := false
				for _, category := range categories {
					if category.ID == draft.CategoryID && (!category.Hidden || entry.CategoryID == category.ID) {
						found = true
						entry.Category = category.Name
						break
					}
				}
				if !found {
					return ChatReply{}, invalid
				}
			} else {
				entry.Category = ""
			}
			for _, tag := range draft.Tags {
				if strings.TrimSpace(tag) == "" || utf8.RuneCountInString(tag) > 40 {
					return ChatReply{}, invalid
				}
			}
			if draft.Payment != nil {
				if entry.Kind != "expense" || draft.Payment.Kind != "payment" || (draft.Payment.Repeat == "none" && (draft.Payment.Plan == nil || draft.Payment.Plan.Kind == "scheduled")) {
					return ChatReply{}, invalid
				}
				known := []domain.Task{}
				for _, t := range tasks {
					if t.Kind == "payment" && !t.Done && !t.Deleted {
						known = append(known, t)
					}
				}
				if entry.Payment != nil {
					known = append(known, *entry.Payment)
				}
				payment, err := parseTaskDraft(draft.Payment, timezone, known)
				if err != nil {
					return ChatReply{}, err
				}
				for _, existing := range known {
					if existing.ID == draft.Payment.ID {
						payment = existing
						break
					}
				}
				if entry.Payment != nil {
					// Unsolicited reviews reuse the accepted schedule unchanged.
					payment = *entry.Payment
				}
				entry.Payment = &payment
			}
			entry.PaymentUnits = draft.PaymentUnits
			if draft.Question != "" {
				if reply.Questions == nil {
					reply.Questions = map[string]string{}
				}
				reply.Questions[entry.ID] = strings.TrimSpace(draft.Question)
			}
			entry.CategoryID = draft.CategoryID
			entry.Tags = draft.Tags
			entry.Notes = draft.Notes
			if entry.Tags == nil {
				entry.Tags = []string{}
			}
			if reason := strings.TrimSpace(draft.Reason); reason != "" {
				if reply.Reasons == nil {
					reply.Reasons = map[string]string{}
				}
				reply.Reasons[entry.ID] = reason
			}
			reply.Entries = append(reply.Entries, entry)
		}
	}
	return reply, nil
}

func parseTaskDraft(draft *TaskDraft, timezone string, tasks []domain.Task) (domain.Task, error) {
	invalid := errors.New("The model returned an invalid payment or task draft")
	task := domain.Task{}
	if draft.ID != "" {
		for _, existing := range tasks {
			if existing.ID == draft.ID {
				task = existing
				break
			}
		}
		if task.ID == "" {
			return domain.Task{}, invalid
		}
	} else {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return domain.Task{}, err
		}
		id[6] = (id[6] & 15) | 64
		id[8] = (id[8] & 63) | 128
		task.ID = fmt.Sprintf("%x-%x-%x-%x-%x", id[0:4], id[4:6], id[6:8], id[8:10], id[10:16])
		task.Timezone = timezone
	}
	previousDate := task.Date
	task.Plan = draft.Plan
	if task.Plan != nil && task.Plan.Quantity == 0 {
		task.Plan.Quantity = 1
	}
	task.Title = draft.Title
	task.Date = draft.Date
	task.Time = draft.Time
	task.Repeat = draft.Repeat
	task.Kind = draft.Kind
	task.Notes = draft.Notes
	if draft.Routine != nil {
		task.Routine = *draft.Routine
	}
	// JSON's string-encoded cents must remain exact; no floating point coercion.
	if draft.Amount == "" {
		draft.Amount = "0"
	}
	if json.Unmarshal([]byte(draft.Amount), &task.Amount) != nil {
		return domain.Task{}, invalid
	}
	task.EstimatedMin, task.EstimatedMax = nil, nil
	if draft.EstimatedMin != nil {
		var amount int64
		if json.Unmarshal([]byte(*draft.EstimatedMin), &amount) != nil || *draft.EstimatedMin == "null" {
			return domain.Task{}, invalid
		}
		task.EstimatedMin = &amount
	}
	if draft.EstimatedMax != nil {
		var amount int64
		if json.Unmarshal([]byte(*draft.EstimatedMax), &amount) != nil || *draft.EstimatedMax == "null" {
			return domain.Task{}, invalid
		}
		task.EstimatedMax = &amount
	}
	// Accept older compatible model output with an exact appointment cost
	// in amount_minor, translating it to the dedicated estimate fields.
	if task.Kind == "appointment" && task.Amount > 0 && task.Amount <= domain.MaxAmount && task.EstimatedMin == nil && task.EstimatedMax == nil {
		amount := task.Amount
		task.EstimatedMin, task.EstimatedMax = &amount, &amount
		task.Amount = 0
	}
	if task.EstimatedMin != nil && task.EstimatedMax != nil {
		if task.Kind == "payment" && *task.EstimatedMin == *task.EstimatedMax {
			task.Amount = *task.EstimatedMin
		} else {
			task.Amount = 0
		}
		notes := []string{}
		for _, line := range strings.Split(task.Notes, "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "Estimated cost:") {
				notes = append(notes, line)
			}
		}
		task.Notes = strings.TrimSpace(strings.Join(notes, "\n"))
	}
	if task.Validate() != nil {
		return domain.Task{}, invalid
	}
	parsed, _ := time.Parse("2006-01-02", task.Date)
	if task.AnchorDay == 0 || previousDate != task.Date {
		task.AnchorDay = parsed.Day()
	}
	return task, nil
}

// ResolveTaskDrafts carries editable conversation state across turns without
// trusting it as a database record or allowing it to bypass record revisions.
func ResolveTaskDrafts(drafts, saved []domain.Task) ([]domain.Task, error) {
	result := make([]domain.Task, 0, len(drafts))
	seen := map[string]bool{}
	if len(drafts) > 8 {
		return nil, errors.New("Send up to eight recent task drafts")
	}
	for _, draft := range drafts {
		if draft.Validate() != nil || draft.Done || draft.Deleted || draft.Version < 0 || seen[draft.ID] {
			return nil, errors.New("A conversation draft is invalid. Start a new draft")
		}
		seen[draft.ID] = true
		found := false
		for _, current := range saved {
			if current.ID != draft.ID {
				continue
			}
			found = true
			if current.Done || current.Deleted || current.Version != draft.Version {
				return nil, errors.New("A task changed since this draft was prepared. Start a new conversation to use its latest details")
			}
			draft.Timezone = current.Timezone
			if draft.Date == current.Date {
				draft.AnchorDay = current.AnchorDay
			}
			break
		}
		if !found && draft.Version != 0 {
			return nil, errors.New("A drafted task is no longer available. Start a new conversation")
		}
		if !found || draft.AnchorDay < 1 || draft.AnchorDay > 31 {
			date, _ := time.Parse("2006-01-02", draft.Date)
			draft.AnchorDay = date.Day()
		}
		result = append(result, draft)
	}
	return result, nil
}
