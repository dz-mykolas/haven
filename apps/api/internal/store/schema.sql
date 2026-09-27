CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY);
CREATE TABLE IF NOT EXISTS accounts (
 id uuid PRIMARY KEY, name text NOT NULL, currency text NOT NULL CHECK(currency='EUR'),
 opening_minor bigint NOT NULL, version bigint NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS entries (
 id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 destination_id uuid REFERENCES accounts(id), kind text NOT NULL CHECK(kind IN ('income','expense','transfer')),
 amount_minor bigint NOT NULL CHECK(amount_minor>0), date date NOT NULL,
 payee text NOT NULL DEFAULT '', category text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
 deleted boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1,
 CHECK ((kind='transfer' AND destination_id IS NOT NULL AND destination_id<>account_id) OR (kind<>'transfer' AND destination_id IS NULL))
);
CREATE INDEX IF NOT EXISTS entries_date ON entries(date DESC);
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY, title text NOT NULL, date date NOT NULL, time text NOT NULL DEFAULT '', timezone text NOT NULL,
 repeat text NOT NULL CHECK(repeat IN ('none','daily','weekly','monthly')), anchor_day integer NOT NULL CHECK(anchor_day BETWEEN 1 AND 31),
 kind text NOT NULL CHECK(kind IN ('task','appointment','payment')), amount_minor bigint NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
 notes text NOT NULL DEFAULT '', done boolean NOT NULL DEFAULT false, deleted boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS task_completions (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id), due_date date NOT NULL, completed_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
