-- Bank logos downloaded once from the address Enable Banking lists and served
-- by Haven itself. An empty row records that a bank has no logo; it is retried
-- after a week.
CREATE TABLE bank_logos (
 bank_name text NOT NULL, country text NOT NULL,
 content_type text NOT NULL DEFAULT '', data bytea NOT NULL DEFAULT '',
 fetched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (bank_name, country)
);
INSERT INTO schema_migrations(version) VALUES(15);
