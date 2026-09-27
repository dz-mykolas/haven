// Package brands matches payee and plan names to brand icons from Simple
// Icons (CC0). The catalogue is embedded, so matching and serving icons never
// contacts another service. Regenerate it with `make brand-icons`.
package brands

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"strings"
	"sync"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

//go:embed brands.json.gz
var catalogue []byte

type Icon struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Hex   string `json:"hex"`
	Path  string `json:"path"`
}

type form struct {
	icon   *Icon
	tokens []string
	length int
}

var (
	load    sync.Once
	byFirst map[string][]form
	// Everyday words that happen to be brand names never pick a logo, so a
	// payee like "Transfer" or "Daily" stays unmatched.
	common = map[string]bool{
		"daily": true, "transfer": true, "fresh": true, "post": true, "premium": true,
		"plus": true, "pay": true, "bank": true, "card": true, "cash": true, "shop": true,
		"store": true, "market": true, "food": true, "cafe": true, "coffee": true, "home": true,
		"line": true, "ring": true, "mint": true, "square": true, "signal": true, "target": true,
		"express": true, "link": true, "digital": true, "travel": true, "energy": true, "water": true,
		"mobile": true, "music": true, "cloud": true, "health": true, "life": true, "news": true,
	}
)

// tokens lowercases, drops accents and apostrophes, and splits on anything
// that is not a letter or digit: "Booking.com" → [booking com].
func tokens(s string) []string {
	folded, _, _ := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), s)
	folded = strings.NewReplacer("'", "", "’", "").Replace(strings.ToLower(folded))
	return strings.FieldsFunc(folded, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
}

func index() {
	var data struct {
		Icons []struct {
			Icon
			Aka []string `json:"aka"`
		} `json:"icons"`
	}
	reader, err := gzip.NewReader(bytes.NewReader(catalogue))
	if err == nil {
		err = json.NewDecoder(reader).Decode(&data)
	}
	if err != nil {
		panic("brands: embedded catalogue is unreadable: " + err.Error())
	}
	byFirst = map[string][]form{}
	for i := range data.Icons {
		icon := &data.Icons[i].Icon
		seen := map[string]bool{}
		for _, name := range append([]string{icon.Title}, data.Icons[i].Aka...) {
			t := tokens(name)
			key := strings.Join(t, " ")
			length := len(strings.Join(t, ""))
			if length < 3 || seen[key] {
				continue
			}
			seen[key] = true
			byFirst[t[0]] = append(byFirst[t[0]], form{icon, t, length})
		}
	}
}

// Match returns the brand whose name appears as whole words near the start of
// name (merchants lead with their brand: "Spotify Premium", "PAYPAL *NETFLIX").
// The longest matching brand name wins, so "Apple iCloud+" is iCloud.
func Match(name string) (Icon, bool) {
	load.Do(index)
	t := tokens(name)
	var best *form
	for pos := 0; pos < len(t) && pos < 3; pos++ {
		for i := range byFirst[t[pos]] {
			f := &byFirst[t[pos]][i]
			if pos+len(f.tokens) > len(t) || !equal(t[pos:pos+len(f.tokens)], f.tokens) {
				continue
			}
			if len(f.tokens) == 1 && common[f.tokens[0]] {
				continue
			}
			if best == nil || f.length > best.length {
				best = f
			}
		}
	}
	if best == nil {
		return Icon{}, false
	}
	return *best.icon, true
}

func equal(a, b []string) bool {
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
