ALTER TABLE tasks ADD COLUMN estimated_min_minor bigint,
                  ADD COLUMN estimated_max_minor bigint,
                  ADD CONSTRAINT tasks_estimated_cost CHECK (
                    (estimated_min_minor IS NULL AND estimated_max_minor IS NULL) OR
                    (estimated_min_minor IS NOT NULL AND estimated_max_minor IS NOT NULL AND
                     estimated_min_minor >= 0 AND estimated_max_minor >= estimated_min_minor AND
                     estimated_max_minor <= 9000000000000));
INSERT INTO schema_migrations(version) VALUES(8);
