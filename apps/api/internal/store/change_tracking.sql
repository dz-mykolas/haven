-- A cheap "did anything change?" counter for background workers. Every write
-- statement to a tracked table advances the sequence, so a worker can skip
-- reloading all data when the value is unchanged. Sequences are not
-- transactional: a rolled-back write still advances it, which only costs one
-- extra reload. The review queue is excluded because the worker itself writes it.
CREATE SEQUENCE haven_changes;
CREATE FUNCTION haven_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM nextval('haven_changes');
  RETURN NULL;
END $$;
-- Later migrations call this again so new tables are tracked too.
CREATE FUNCTION haven_track_changes() RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema()
    AND tablename NOT IN ('schema_migrations', 'assistant_reviews')
    AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'haven_changed' AND tgrelid = format('%I', tablename)::regclass)
  LOOP
    EXECUTE format('CREATE TRIGGER haven_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION haven_changed()', t);
  END LOOP;
END $$;
SELECT haven_track_changes();
INSERT INTO schema_migrations(version) VALUES(16);
