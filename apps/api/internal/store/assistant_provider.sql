CREATE TABLE assistant_provider (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 base_url text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '',
 protocol text NOT NULL DEFAULT 'chat_completions' CHECK(protocol IN ('chat_completions','responses')),
 api_key_cipher bytea NOT NULL DEFAULT '', version bigint NOT NULL DEFAULT 1,
 tested_at timestamptz
);
INSERT INTO assistant_provider(singleton) VALUES(true);
INSERT INTO schema_migrations(version) VALUES(7);
