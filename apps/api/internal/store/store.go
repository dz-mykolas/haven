package store

import (
	"context"
	_ "embed"
	"errors"
	"reflect"
	"slices"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/dz-mykolas/haven/apps/api/internal/assistant"
	"github.com/dz-mykolas/haven/apps/api/internal/domain"
)

//go:embed feed_indexes.sql
var feedIndexesSchema string

//go:embed bank_logos.sql
var bankLogosSchema string

//go:embed change_tracking.sql
var changeTrackingSchema string

//go:embed followups.sql
var followUpsSchema string

//go:embed tasks_schedule.sql
var tasksScheduleSchema string

//go:embed schema.sql
var schema string

//go:embed banking.sql
var bankingSchema string

//go:embed bank_ledger.sql
var bankLedgerSchema string

//go:embed classification.sql
var classificationSchema string

//go:embed account_removal.sql
var accountRemovalSchema string

//go:embed assistant.sql
var assistantSchema string

//go:embed assistant_provider.sql
var assistantProviderSchema string

//go:embed estimated_costs.sql
var estimatedCostsSchema string

//go:embed reviews.sql
var reviewsSchema string

//go:embed review_context.sql
var reviewContextSchema string

//go:embed recurring_payments.sql
var recurringPaymentsSchema string

//go:embed automatic_classification.sql
var automaticClassificationSchema string

//go:embed payment_forecasts.sql
var paymentForecastsSchema string

type Store struct {
	Pool *pgxpool.Pool
	// reviewsSeen is the change counter at the last full review reconcile.
	reviewsSeen atomic.Int64
}
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string     { return e.Message }
func bad(message string) error     { return &Error{400, message} }
func conflict(version int64) error { return &Error{409, domain.Conflict(version).Error()} }

const accountCols = `'' AS source, NULL::bigint AS bank_balance_minor, id::text, name, currency, opening_minor, version`
const entryCols = `'' AS source, id::text, account_id::text, COALESCE(destination_id::text,'') AS destination_id, kind, amount_minor, date::text, payee, COALESCE((SELECT name FROM money_categories WHERE id=entries.category_id),'') AS category, COALESCE(category_id::text,'') AS category_id, tags, '' AS bank_description, notes, deleted, version`
const taskCols = `plan,id::text,title,COALESCE(date::text,'') AS date,time,timezone,repeat,anchor_day,kind,amount_minor,notes,tags,every,weekdays,COALESCE(until::text,'') AS until,income,COALESCE(starts_on::text,'') AS starts_on,COALESCE(continues_from::text,'') AS continues_from,done,deleted,version,estimated_min_minor,estimated_max_minor`

func Open(ctx context.Context, url string) (*Store, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	s := &Store{Pool: p}
	s.reviewsSeen.Store(-1)
	tx, err := p.Begin(ctx)
	if err == nil {
		defer tx.Rollback(ctx)
		_, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(728193)`)
		if err == nil {
			_, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)")
		}
		if err == nil {
			var version int
			err = tx.QueryRow(ctx, "SELECT COALESCE(max(version),0) FROM schema_migrations").Scan(&version)
			if err == nil && version > 18 {
				err = errors.New("database schema is newer than this Haven build")
			}
			if err == nil && version == 0 {
				_, err = tx.Exec(ctx, schema)
			}
			if err == nil && version < 2 {
				_, err = tx.Exec(ctx, bankingSchema)
			}
			if err == nil && version < 3 {
				_, err = tx.Exec(ctx, bankLedgerSchema)
			}
			if err == nil && version < 4 {
				_, err = tx.Exec(ctx, classificationSchema)
			}
			if err == nil && version < 5 {
				_, err = tx.Exec(ctx, accountRemovalSchema)
			}
			if err == nil && version < 6 {
				_, err = tx.Exec(ctx, assistantSchema)
			}
			if err == nil && version < 7 {
				_, err = tx.Exec(ctx, assistantProviderSchema)
			}
			if err == nil && version < 8 {
				_, err = tx.Exec(ctx, estimatedCostsSchema)
			}
			if err == nil && version < 9 {
				_, err = tx.Exec(ctx, reviewsSchema)
			}
			if err == nil && version < 10 {
				_, err = tx.Exec(ctx, reviewContextSchema)
			}
			if err == nil && version < 11 {
				_, err = tx.Exec(ctx, recurringPaymentsSchema)
			}
			if err == nil && version < 12 {
				_, err = tx.Exec(ctx, automaticClassificationSchema)
			}
			if err == nil && version < 13 {
				_, err = tx.Exec(ctx, paymentForecastsSchema)
			}
			if err == nil && version < 14 {
				_, err = tx.Exec(ctx, feedIndexesSchema)
			}
			if err == nil && version < 15 {
				_, err = tx.Exec(ctx, bankLogosSchema)
			}
			if err == nil && version < 16 {
				_, err = tx.Exec(ctx, changeTrackingSchema)
			}
			if err == nil && version < 17 {
				_, err = tx.Exec(ctx, followUpsSchema)
			}
			if err == nil && version < 18 {
				_, err = tx.Exec(ctx, tasksScheduleSchema)
			}
		}
		if err == nil {
			err = tx.Commit(ctx)
		}
	}
	if err != nil {
		p.Close()
		return nil, err
	}
	return s, nil
}
func list[T any](ctx context.Context, tx pgx.Tx, query string, args ...any) ([]T, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	v, err := pgx.CollectRows(rows, pgx.RowToStructByName[T])
	if v == nil {
		v = []T{}
	}
	return v, err
}
func one[T any](ctx context.Context, tx pgx.Tx, query string, args ...any) (T, error) {
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		var zero T
		return zero, err
	}
	return pgx.CollectOneRow(rows, pgx.RowToStructByName[T])
}
func (s *Store) Snapshot(ctx context.Context, month string) (domain.Snapshot, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return domain.Snapshot{}, err
	}
	defer tx.Rollback(ctx)
	result, err := snapshot(ctx, tx, month)
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
func snapshot(ctx context.Context, tx pgx.Tx, month string) (domain.Snapshot, error) {
	a, err := list[domain.Account](ctx, tx, `SELECT `+accountCols+` FROM accounts WHERE NOT removed ORDER BY name,id`)
	if err != nil {
		return domain.Snapshot{}, err
	}
	e, err := list[domain.Entry](ctx, tx, `SELECT `+entryCols+` FROM entries WHERE NOT deleted ORDER BY date DESC,id`)
	if err != nil {
		return domain.Snapshot{}, err
	}
	t, err := list[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE NOT deleted ORDER BY done,date,time,id`)
	if err != nil {
		return domain.Snapshot{}, err
	}
	if t, err = currentTasks(ctx, tx, t); err != nil {
		return domain.Snapshot{}, err
	}
	a, e, err = appendBankLedger(ctx, tx, a, e)
	if err != nil {
		return domain.Snapshot{}, err
	}
	if err = attachPayments(ctx, tx, e, t); err != nil {
		return domain.Snapshot{}, err
	}
	result := domain.Summarize(a, visibleEntries(a, e), t, month)
	result.Categories, result.Tags, err = classificationCatalog(ctx, tx)
	if err != nil {
		return domain.Snapshot{}, err
	}
	return result, err
}

// Each mutation locks its record. New IDs are serialized so identical retried creates are safe.
func (s *Store) mutate(ctx context.Context, id string, f func(pgx.Tx) error) error {
	if !domain.ValidID(id) {
		return bad("Invalid record ID")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, id); err != nil {
		return err
	}
	if err = f(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func revision[T any](old T, in T, oldVersion, version int64, err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		if version != 0 {
			return false, &Error{404, "Record not found"}
		}
		return true, nil
	}
	if err != nil {
		return false, err
	}
	if version == 0 {
		if reflect.DeepEqual(old, in) {
			return false, nil
		}
		return false, conflict(oldVersion)
	}
	if version != oldVersion {
		return false, conflict(oldVersion)
	}
	return true, nil
}
func (s *Store) SaveAccount(ctx context.Context, a domain.Account) (domain.Account, error) {
	if a.Source != "" || a.BankBalance != nil {
		return a, bad("Bank accounts are managed by sync")
	}
	if err := a.Validate(); err != nil {
		return a, bad(err.Error())
	}
	err := s.mutate(ctx, a.ID, func(tx pgx.Tx) error {
		if err := protectBankRecord(ctx, tx, a.ID); err != nil {
			return err
		}
		var removed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE id=$1 AND removed)`, a.ID).Scan(&removed); err != nil {
			return err
		}
		if removed {
			return &Error{410, "This account was removed"}
		}
		old, err := one[domain.Account](ctx, tx, `SELECT `+accountCols+` FROM accounts WHERE id=$1 FOR UPDATE`, a.ID)
		v := a.Version
		a.Version = old.Version
		write, err := revision(old, a, old.Version, v, err)
		if err != nil {
			return err
		}
		if !write {
			a = old
			return nil
		}
		a.Version = v + 1
		_, err = tx.Exec(ctx, `INSERT INTO accounts(id,name,currency,opening_minor,version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET name=$2,currency=$3,opening_minor=$4,version=$5`, a.ID, a.Name, a.Currency, a.Opening, a.Version)
		return err
	})
	return a, err
}
func (s *Store) SaveEntry(ctx context.Context, e domain.Entry) (domain.Entry, error) {
	payment := e.Payment
	units := e.PaymentUnits
	e.PaymentUnits = 0
	if e.Deleted {
		payment = nil
	}
	e.Payment = nil
	if e.Source != "" {
		return e, bad("Bank transactions are managed by sync")
	}
	e.BankDescription = ""
	e.Category = ""
	if err := e.Validate(); err != nil {
		return e, bad(err.Error())
	}
	err := s.mutate(ctx, e.ID, func(tx pgx.Tx) error {
		if err := classificationLock(ctx, tx); err != nil {
			return err
		}
		if err := protectBankRecord(ctx, tx, e.ID); err != nil {
			return err
		}
		old, err := one[domain.Entry](ctx, tx, `SELECT `+entryCols+` FROM entries WHERE id=$1 FOR UPDATE`, e.ID)
		if err := normalizeClassification(ctx, tx, &e.CategoryID, &e.Category, &e.Tags, e.Notes, old.CategoryID); err != nil {
			return err
		}
		v := e.Version
		e.Version = old.Version
		write, err := revision(old, e, old.Version, v, err)
		if err != nil {
			return err
		}
		if !write {
			e = old
			e.PaymentUnits = units
			e.Payment, err = saveEntryPayment(ctx, tx, e, payment)
			if err == nil {
				err = completeReview(ctx, tx, e.ID)
			}
			return err
		}
		e.Version = v + 1
		var count int
		err = tx.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE NOT removed AND (id=$1 OR id=NULLIF($2,'')::uuid)`, e.AccountID, e.DestinationID).Scan(&count)
		if err != nil {
			return err
		}
		expected := 1
		if e.Kind == "transfer" {
			expected = 2
		}
		if count != expected {
			return bad("Account no longer exists")
		}
		_, err = tx.Exec(ctx, `INSERT INTO entries(id,account_id,destination_id,kind,amount_minor,date,payee,category,notes,deleted,version,category_id,tags) VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,$8,$9,$10,$11,NULLIF($12,'')::uuid,$13) ON CONFLICT(id) DO UPDATE SET account_id=$2,destination_id=NULLIF($3,'')::uuid,kind=$4,amount_minor=$5,date=$6,payee=$7,category=$8,notes=$9,deleted=$10,version=$11,category_id=NULLIF($12,'')::uuid,tags=$13`, e.ID, e.AccountID, e.DestinationID, e.Kind, e.Amount, e.Date, e.Payee, e.Category, e.Notes, e.Deleted, e.Version, e.CategoryID, e.Tags)
		if err != nil {
			return err
		}
		e.PaymentUnits = units
		e.Payment, err = saveEntryPayment(ctx, tx, e, payment)
		if err != nil {
			return err
		}
		return completeReview(ctx, tx, e.ID)
	})
	return e, err
}
func (s *Store) SaveTask(ctx context.Context, t domain.Task) (domain.Task, error) {
	err := s.mutate(ctx, t.ID, func(tx pgx.Tx) error {
		var err error
		t, err = saveTask(ctx, tx, t)
		return err
	})
	return t, err
}
func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
func saveTask(ctx context.Context, tx pgx.Tx, t domain.Task) (domain.Task, error) {
	t = t.Normalize()
	if t.Plan != nil && t.Plan.Kind == "prepaid" && t.Plan.ExpiresOn != "" && t.Plan.CoverageThrough == "" {
		p := *t.Plan
		location, err := time.LoadLocation(t.Timezone)
		if err != nil {
			location = time.UTC
		}
		p.CoverageThrough = time.Now().In(location).Format("2006-01-02")
		t.Plan = &p
	}
	if err := t.Validate(); err != nil {
		return t, bad(err.Error())
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, t.ID); err != nil {
		return t, err
	}
	old, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1 FOR UPDATE`, t.ID)
	// Follow-ups and task chains are written only by the assistant worker.
	old = domain.CatchUp(old, time.Now())
	t.FollowUp, t.ContinuesFrom = nil, old.ContinuesFrom
	// A new or changed schedule starts on the task's date.
	if old.StartsOn == "" || old.Repeat != t.Repeat || max(old.Every, 1) != t.Every || !slices.Equal(old.Weekdays, t.Weekdays) {
		t.StartsOn = t.Date
	} else {
		t.StartsOn = old.StartsOn
	}
	v := t.Version
	t.Version = old.Version
	t.AnchorDay = old.AnchorDay
	if old.Date != t.Date || t.AnchorDay == 0 {
		d, _ := time.Parse("2006-01-02", t.Date)
		t.AnchorDay = d.Day()
	}
	write, err := revision(old, t, old.Version, v, err)
	if err != nil {
		return t, err
	}
	if !write {
		t = old
		return t, nil
	}
	t.Version = v + 1
	if err = putTask(ctx, tx, t); err != nil {
		return t, err
	}
	return t, queueFollowUp(ctx, tx, t)
}
func putTask(ctx context.Context, tx pgx.Tx, t domain.Task) error {
	_, err := tx.Exec(ctx, `INSERT INTO tasks(id,title,date,time,timezone,repeat,anchor_day,kind,amount_minor,notes,done,deleted,version,estimated_min_minor,estimated_max_minor,plan,tags,continues_from,every,weekdays,until,income,starts_on) VALUES($1,$2,NULLIF($3,'')::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULLIF($18,'')::uuid,$19,$20,NULLIF($21,'')::date,$22,NULLIF($23,'')::date) ON CONFLICT(id) DO UPDATE SET title=$2,date=NULLIF($3,'')::date,time=$4,timezone=$5,repeat=$6,anchor_day=$7,kind=$8,amount_minor=$9,notes=$10,done=$11,deleted=$12,version=$13,estimated_min_minor=$14,estimated_max_minor=$15,plan=$16,tags=$17,continues_from=NULLIF($18,'')::uuid,every=$19,weekdays=$20,until=NULLIF($21,'')::date,income=$22,starts_on=NULLIF($23,'')::date`, t.ID, t.Title, t.Date, t.Time, t.Timezone, t.Repeat, t.AnchorDay, t.Kind, t.Amount, t.Notes, t.Done, t.Deleted, t.Version, t.EstimatedMin, t.EstimatedMax, t.Plan, nonNil(t.Tags), t.ContinuesFrom, max(t.Every, 1), nonNil(t.Weekdays), t.Until, t.Income, t.StartsOn)
	return err
}
func (s *Store) CompleteTask(ctx context.Context, id, completionID string, version int64) (domain.Task, error) {
	var result domain.Task
	if !domain.ValidID(completionID) {
		return result, bad("Invalid completion ID")
	}
	err := s.mutate(ctx, id, func(tx pgx.Tx) error {
		t, err := one[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks WHERE id=$1 FOR UPDATE`, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return &Error{404, "Task not found"}
		}
		if err != nil {
			return err
		}
		result = t
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "completion:"+completionID); err != nil {
			return err
		}
		var completedTask string
		err = tx.QueryRow(ctx, `SELECT task_id::text FROM task_completions WHERE id=$1`, completionID).Scan(&completedTask)
		if err == nil {
			if completedTask != id {
				return &Error{409, "Completion ID already used"}
			}
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if version != t.Version {
			return conflict(t.Version)
		}
		t = domain.CatchUp(t, time.Now())
		next, err := domain.Complete(t)
		if err != nil {
			return bad(err.Error())
		}
		next.Version++
		if _, err = tx.Exec(ctx, `INSERT INTO task_completions(id,task_id,due_date) VALUES($1,$2,$3)`, completionID, id, t.Date); err != nil {
			return err
		}
		if err = putTask(ctx, tx, next); err != nil {
			return err
		}
		// Finishing a one-off task is a moment its notes may say what comes next.
		if next.Done {
			if _, err = tx.Exec(ctx, `UPDATE task_followups SET status='checking',attempts=0,error='',available_at=now(),updated_at=now() WHERE task_id=$1 AND summary<>'' AND status IN ('ready','failed')`, id); err != nil {
				return err
			}
		}
		result = next
		return nil
	})
	return result, err
}

type Backup struct {
	AssistantSettings assistant.Settings  `json:"assistant_settings"`
	Categories        []domain.Category   `json:"categories"`
	Tags              []string            `json:"tags"`
	Format            string              `json:"format"`
	ExportedAt        time.Time           `json:"exported_at"`
	Accounts          []domain.Account    `json:"accounts"`
	Entries           []domain.Entry      `json:"entries"`
	Tasks             []domain.Task       `json:"tasks"`
	Completions       []domain.Completion `json:"completions"`
}

func (s *Store) Backup(ctx context.Context) (Backup, error) {
	b := Backup{Format: "haven-1", ExportedAt: time.Now().UTC()}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return b, err
	}
	defer tx.Rollback(ctx)
	if b.Accounts, err = list[domain.Account](ctx, tx, `SELECT `+accountCols+` FROM accounts WHERE NOT removed ORDER BY id`); err != nil {
		return b, err
	}
	if b.Entries, err = list[domain.Entry](ctx, tx, `SELECT `+entryCols+` FROM entries ORDER BY id`); err != nil {
		return b, err
	}
	if b.Tasks, err = list[domain.Task](ctx, tx, `SELECT `+taskCols+` FROM tasks ORDER BY id`); err != nil {
		return b, err
	}
	if b.Completions, err = list[domain.Completion](ctx, tx, `SELECT id::text,task_id::text,due_date::text,completed_at FROM task_completions ORDER BY completed_at`); err != nil {
		return b, err
	}
	b.Accounts, b.Entries, err = appendBankLedger(ctx, tx, b.Accounts, b.Entries)
	if err != nil {
		return b, err
	}
	b.Entries = visibleEntries(b.Accounts, b.Entries)
	if err = attachPayments(ctx, tx, b.Entries, b.Tasks); err != nil {
		return b, err
	}
	b.Categories, b.Tags, err = classificationCatalog(ctx, tx)
	if err != nil {
		return b, err
	}
	b.AssistantSettings, err = assistantSettings(ctx, tx, false)
	if err != nil {
		return b, err
	}
	return b, tx.Commit(ctx)
}
