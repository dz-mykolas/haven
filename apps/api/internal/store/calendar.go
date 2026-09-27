package store

import (
	"context"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Store) TaskCalendar(ctx context.Context, month string) (domain.TaskCalendar, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return domain.TaskCalendar{}, err
	}
	defer tx.Rollback(ctx)
	tasks, err := list[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE NOT deleted ORDER BY id`)
	if err != nil {
		return domain.TaskCalendar{}, err
	}
	if tasks, err = currentTasks(ctx, tx, tasks); err != nil {
		return domain.TaskCalendar{}, err
	}
	from, to := domain.CalendarBounds(month)
	completions, err := list[domain.Completion](ctx, tx, `SELECT id::text,task_id::text,due_date::text,completed_at FROM task_completions WHERE due_date BETWEEN $1 AND $2 ORDER BY due_date,id`, from, to)
	if err != nil {
		return domain.TaskCalendar{}, err
	}
	result := domain.Calendar(tasks, completions, month)
	return result, tx.Commit(ctx)
}
