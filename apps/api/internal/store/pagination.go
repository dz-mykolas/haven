package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

const FeedPageSize = 50

type feedCursor struct {
	Scope   string    `json:"scope"`
	Date    string    `json:"date"`
	ID      string    `json:"id"`
	Created time.Time `json:"created,omitempty"`
}

func cursorScope(value any) string {
	raw, _ := json.Marshal(value)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:12])
}
func encodeCursor(c feedCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}
func decodeCursor(token, scope string) (feedCursor, error) {
	var c feedCursor
	if token == "" {
		return c, nil
	}
	if len(token) > 1024 {
		return c, bad("Invalid page cursor")
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return c, bad("Invalid page cursor")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&c) != nil || decoder.Decode(new(any)) != io.EOF || c.Scope != scope || !domain.ValidDate(c.Date) || !domain.ValidID(c.ID) {
		return c, bad("Invalid page cursor for these filters")
	}
	return c, nil
}
