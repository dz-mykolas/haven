package store

import (
	"context"
	"reflect"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/jackc/pgx/v5"
)

const assistantColumns = `mode,presentation,offer_estimated_costs,skills,version`

func (s *Store) AssistantSettings(ctx context.Context) (assistant.Settings, error) {
	var settings assistant.Settings
	err := s.Pool.QueryRow(ctx, `SELECT `+assistantColumns+` FROM assistant_settings WHERE singleton`).Scan(&settings.Mode, &settings.Presentation, &settings.OfferEstimatedCosts, &settings.Skills, &settings.Version)
	return settings.WithSkills(nil), err
}
func (s *Store) SaveAssistantSettings(ctx context.Context, in assistant.Settings) (assistant.Settings, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return assistant.Settings{}, err
	}
	defer tx.Rollback(ctx)
	old, err := assistantSettings(ctx, tx, true)
	if err != nil {
		return assistant.Settings{}, err
	}
	// Clients that predate a skill keep its current setting.
	in = in.WithSkills(old.Skills)
	if err := in.Validate(); err != nil {
		return assistant.Settings{}, bad(err.Error())
	}
	// A retry of an already-applied update is safe, but stale differing edits conflict.
	expected := in
	expected.Version = old.Version
	if reflect.DeepEqual(expected, old) && (in.Version == old.Version || in.Version == old.Version-1) {
		return old, tx.Commit(ctx)
	}
	if in.Version != old.Version {
		return assistant.Settings{}, conflict(old.Version)
	}
	in.Version++
	_, err = tx.Exec(ctx, `UPDATE assistant_settings SET mode=$1,presentation=$2,offer_estimated_costs=$3,skills=$4,version=$5 WHERE singleton`, in.Mode, in.Presentation, in.OfferEstimatedCosts, in.Skills, in.Version)
	if err != nil {
		return assistant.Settings{}, err
	}
	return in, tx.Commit(ctx)
}
func assistantSettings(ctx context.Context, tx pgx.Tx, lock bool) (assistant.Settings, error) {
	query := `SELECT ` + assistantColumns + ` FROM assistant_settings WHERE singleton`
	if lock {
		query += ` FOR UPDATE`
	}
	var settings assistant.Settings
	err := tx.QueryRow(ctx, query).Scan(&settings.Mode, &settings.Presentation, &settings.OfferEstimatedCosts, &settings.Skills, &settings.Version)
	return settings.WithSkills(nil), err
}
