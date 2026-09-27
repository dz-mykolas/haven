package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBrandIconEndpoint(t *testing.T) {
	h := New(nil, []string{"http://127.0.0.1:4321"})
	get := func(query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/icons?"+query, nil)
		req.Host = "127.0.0.1:8080"
		res := httptest.NewRecorder()
		h.ServeHTTP(res, req)
		return res
	}
	res := get("name=Spotify+Premium")
	var icon struct{ Slug, Title, Hex, Path string }
	if res.Code != 200 || json.NewDecoder(res.Body).Decode(&icon) != nil || icon.Slug != "spotify" || icon.Path == "" {
		t.Fatalf("got %d %+v", res.Code, icon)
	}
	if res.Header().Get("Cache-Control") != "private, max-age=604800" {
		t.Fatalf("icons should be cacheable, got %q", res.Header().Get("Cache-Control"))
	}
	if res := get("name=Apartment+rent"); res.Code != http.StatusNotFound {
		t.Fatalf("unknown names should be 404, got %d", res.Code)
	}
	if res := get("name="); res.Code != http.StatusBadRequest {
		t.Fatalf("empty names should be 400, got %d", res.Code)
	}
}
