package store

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

func TestDefaultCategories(t *testing.T) {
	database := os.Getenv("HAVEN_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("requires disposable PostgreSQL")
	}
	cfg, err := pgx.ParseConfig(database)
	if err != nil || !strings.HasSuffix(cfg.Database, "_test") {
		t.Fatal("database must end in _test")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	name := fmt.Sprintf("category_defaults_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE")
	scopedURL := database + " search_path=" + name
	if strings.Contains(database, "://") {
		u, err := url.Parse(database)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		q.Set("search_path", name)
		u.RawQuery = q.Encode()
		scopedURL = u.String()
	}
	s, err := Open(ctx, scopedURL)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Pool.Close()
	snap, err := s.Snapshot(ctx, "2026-09")
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for _, c := range snap.Categories {
		if c.Hidden {
			t.Fatal("fresh catalog contains hidden legacy categories")
		}
		names = append(names, c.Name)
	}
	if !reflect.DeepEqual(names, []string{"Everyday", "Occasional", "Recurring"}) {
		t.Fatalf("unexpected defaults: %v", names)
	}
	for _, want := range []string{"Health", "Fitness", "Home", "Groceries", "Dining", "Transport", "Travel", "Entertainment", "Electronics", "Salary", "Refund", "Interest"} {
		found := false
		for _, tag := range snap.Tags {
			found = found || tag == want
		}
		if !found {
			t.Fatalf("missing purpose tag %s", want)
		}
	}
	// Seeding happens once: reopening must preserve edits and stable category IDs.
	custom := snap.Categories[0]
	custom.Name = "My everyday spending"
	custom, err = s.SaveCategory(ctx, custom)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(ctx, scopedURL)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Pool.Close()
	snap, err = reopened.Snapshot(ctx, "2026-09")
	if err != nil || len(snap.Categories) != 3 {
		t.Fatalf("reopening changed the catalog: %+v, %v", snap.Categories, err)
	}
	found := false
	for _, c := range snap.Categories {
		found = found || c == custom
	}
	if !found {
		t.Fatal("reopening lost custom category edit")
	}
}

func TestReviewEligibility(t *testing.T) {
	for _, tc := range []struct {
		name  string
		entry domain.Entry
		want  bool
	}{
		{"new expense", domain.Entry{Kind: "expense", Version: 1}, true},
		{"income purpose tags", domain.Entry{Kind: "income", Version: 1}, true},
		{"user categorized", domain.Entry{Kind: "expense", CategoryID: "category", Version: 1}, false},
		{"user revised", domain.Entry{Kind: "expense", Version: 2}, false},
		{"recurring schedule backfill", domain.Entry{Kind: "expense", CategoryID: "recurring", Category: "Recurring", Version: 3}, true},
		{"already planned", domain.Entry{Kind: "expense", CategoryID: "recurring", Category: "Recurring", Version: 3, Payment: &domain.Task{ID: "planned"}}, false},
		{"transfer", domain.Entry{Kind: "transfer", Version: 1}, false},
		{"deleted", domain.Entry{Kind: "expense", Version: 1, Deleted: true}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if reviewEligible(tc.entry) != tc.want {
				t.Fatal("unexpected review eligibility")
			}
		})
	}
}
