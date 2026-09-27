-- Keep the pre-AI annotations and the last applied revision for safe undo and
-- ownership checks. A manual revision always wins over this recorded revision.
CREATE TABLE assistant_classifications (
 entry_id uuid PRIMARY KEY,
 original jsonb NOT NULL,
 applied jsonb NOT NULL,
 undone boolean NOT NULL DEFAULT false,
 locked boolean NOT NULL DEFAULT false
);
ALTER TABLE assistant_reviews DROP CONSTRAINT assistant_reviews_status_check;
ALTER TABLE assistant_reviews ADD CONSTRAINT assistant_reviews_status_check CHECK (
 status IN ('queued','processing','review','dismissed','completed','unchanged','stale','failed','auto_applied','undone')
);
-- Re-evaluate outstanding drafts under the new automatic categorization policy.
-- Saved choices and dismissals are untouched.
UPDATE assistant_reviews SET status='queued',draft=NULL,reason='',attempts=0,available_at=now()
 WHERE status='review';
INSERT INTO schema_migrations(version) VALUES(12);
