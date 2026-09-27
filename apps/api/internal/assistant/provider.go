package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Provider struct {
	BaseURL   string     `json:"base_url"`
	Model     string     `json:"model"`
	Protocol  string     `json:"protocol"`
	HasAPIKey bool       `json:"has_api_key"`
	Version   int64      `json:"version"`
	TestedAt  *time.Time `json:"tested_at"`
}
type ProviderUpdate struct {
	BaseURL  string  `json:"base_url"`
	Model    string  `json:"model"`
	Protocol string  `json:"protocol"`
	APIKey   *string `json:"api_key"`
	Version  int64   `json:"version"`
}

func (in *ProviderUpdate) Validate() error {
	in.BaseURL = strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	for _, suffix := range []string{"/chat/completions", "/responses"} {
		in.BaseURL = strings.TrimSuffix(in.BaseURL, suffix)
	}
	u, err := url.Parse(in.BaseURL)
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(in.BaseURL) > 2048 {
		return errors.New("Enter an HTTP or HTTPS API base URL without credentials, query, or fragment")
	}
	host := strings.ToLower(u.Hostname())
	ip := net.ParseIP(host)
	if host == "metadata.google.internal" || (ip != nil && (ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast())) {
		return errors.New("Choose a model server address")
	}
	if u.Scheme == "http" && host != "localhost" && host != "host.docker.internal" && !strings.HasSuffix(host, ".localhost") && (ip == nil || (!ip.IsLoopback() && !ip.IsPrivate())) {
		return errors.New("Use HTTPS for remote endpoints, or a local/private address for HTTP")
	}
	in.Model = strings.TrimSpace(in.Model)
	if in.Model == "" || len(in.Model) > 200 || strings.ContainsAny(in.Model, "\r\n") {
		return errors.New("Enter a model ID")
	}
	if in.Protocol != "chat_completions" && in.Protocol != "responses" {
		return errors.New("Choose Chat Completions or Responses")
	}
	if in.Version < 0 {
		return errors.New("Invalid connection version")
	}
	if in.APIKey != nil && (len(*in.APIKey) > 8192 || strings.TrimSpace(*in.APIKey) != *in.APIKey || strings.ContainsAny(*in.APIKey, "\r\n")) {
		return errors.New("Enter an API key without surrounding spaces or line breaks")
	}
	return nil
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Complete uses only the common non-streaming text contract. No redirects or
// raw provider error bodies are exposed: either can disclose the supplied key.
func Complete(ctx context.Context, config Provider, key string, system string, messages []Message) (string, error) {
	body := map[string]any{"model": config.Model}
	path := "/chat/completions"
	if config.Protocol == "responses" {
		path = "/responses"
		body["instructions"] = system
		body["input"] = messages
		body["store"] = false
	} else {
		body["messages"] = append([]Message{{Role: "system", Content: system}}, messages...)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", config.BaseURL+path, bytes.NewReader(encoded))
	if err != nil {
		return "", errors.New("Invalid model endpoint")
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	client := &http.Client{Timeout: 75 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New("Could not reach the model endpoint. Check its URL and that the server is running")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		switch res.StatusCode {
		case 401, 403:
			return "", errors.New("The model endpoint rejected authentication. Check the API key and model access")
		case 404:
			return "", errors.New("Model or API route not found. Check the base URL, model ID, and API format")
		case 429:
			return "", errors.New("The model endpoint is rate limited or out of quota. Try again later")
		case 400, 422:
			return "", errors.New("The endpoint rejected this request. Check that the model supports the selected API format")
		default:
			return "", errors.New("The model endpoint could not complete the request. Check the connection and try again")
		}
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return "", errors.New("The model returned an unreadable or oversized response")
	}
	var output string
	if config.Protocol == "responses" {
		var data struct {
			Status string `json:"status"`
			Output []struct {
				Type    string `json:"type"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			} `json:"output"`
		}
		if json.Unmarshal(raw, &data) != nil || data.Status != "completed" {
			return "", errors.New("The model response was incomplete. Try again")
		}
		for _, item := range data.Output {
			if item.Type == "message" {
				for _, part := range item.Content {
					if part.Type == "output_text" {
						output += part.Text
					}
				}
			}
		}
	} else {
		var data struct {
			Choices []struct {
				FinishReason string `json:"finish_reason"`
				Message      struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		}
		if json.Unmarshal(raw, &data) != nil || len(data.Choices) == 0 {
			return "", errors.New("The endpoint did not return a Chat Completions response")
		}
		if data.Choices[0].FinishReason != "stop" && data.Choices[0].FinishReason != "" {
			return "", errors.New("The model response was incomplete or refused. Try a shorter request")
		}
		output = data.Choices[0].Message.Content
	}
	if strings.TrimSpace(output) == "" {
		return "", errors.New("The model returned no text. Check the selected model and API format")
	}
	return output, nil
}
