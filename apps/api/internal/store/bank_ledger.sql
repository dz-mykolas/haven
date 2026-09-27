-- Bank history stays separate from manually entered records, but is projected
-- into the same Money view. Session UIDs are never used as durable identities.
CREATE TABLE bank_ledger_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 app_id text NOT NULL, bank_name text NOT NULL, country text NOT NULL,
 identity_hash text NOT NULL, environment text NOT NULL CHECK(environment='SANDBOX'),
 name text NOT NULL, currency text NOT NULL CHECK(currency='EUR'), iban text NOT NULL,
 balance_minor bigint NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(app_id, bank_name, country, environment, identity_hash)
);
CREATE TABLE bank_ledger_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_id uuid NOT NULL REFERENCES bank_ledger_accounts(id),
 reference text NOT NULL, payload jsonb NOT NULL,
 UNIQUE(account_id, reference)
);
INSERT INTO schema_migrations(version) VALUES(3);
