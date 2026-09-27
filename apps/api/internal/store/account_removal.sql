-- Retain transfer history and stable identities so removal cannot be undone by sync.
ALTER TABLE accounts ADD COLUMN removed boolean NOT NULL DEFAULT false;
ALTER TABLE bank_ledger_accounts ADD COLUMN removed boolean NOT NULL DEFAULT false;
INSERT INTO schema_migrations(version) VALUES(5);
