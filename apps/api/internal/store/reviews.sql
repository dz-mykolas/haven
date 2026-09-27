-- One durable review per transaction, shared by history and future arrivals.
CREATE TABLE assistant_reviews (
 entry_id uuid PRIMARY KEY,
 original jsonb NOT NULL,
 draft jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','review','dismissed','completed','unchanged','stale','failed')),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_reviews_pending ON assistant_reviews(status, available_at, created_at DESC);
INSERT INTO schema_migrations(version) VALUES(9);
