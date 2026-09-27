ALTER TABLE assistant_reviews ADD COLUMN reason text NOT NULL DEFAULT '';
INSERT INTO schema_migrations(version) VALUES(10);
