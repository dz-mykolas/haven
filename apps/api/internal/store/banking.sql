-- Sandbox records are deliberately separate from the personal Money ledger.
CREATE TABLE bank_authorizations (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL, app_id text NOT NULL,
 bank_name text NOT NULL, country text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE TABLE bank_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), app_id text NOT NULL,
 bank_name text NOT NULL, country text NOT NULL,
 environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 session_data jsonb NOT NULL, valid_until timestamptz NOT NULL,
 snapshot jsonb NOT NULL DEFAULT '[]', synced_at timestamptz,
 disconnected boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES(2);
