-- Tasks get tags (built-in ones such as "@skip-missed" change behaviour),
-- repeat intervals, weekdays, an end date and money direction. starts_on is
-- when the current schedule began, so missed and taken days can be listed.
ALTER TABLE tasks ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
UPDATE tasks SET tags = '{@skip-missed}' WHERE routine AND kind = 'task';
ALTER TABLE tasks DROP COLUMN routine;
ALTER TABLE tasks ADD COLUMN every integer NOT NULL DEFAULT 1 CHECK (every BETWEEN 1 AND 365);
ALTER TABLE tasks ADD COLUMN weekdays integer[] NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN until date;
ALTER TABLE tasks ADD COLUMN income boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN starts_on date;
UPDATE tasks SET starts_on = date;
-- Assistant changes can wait for the user's approval.
ALTER TABLE task_followup_events ADD COLUMN proposal jsonb;
ALTER TABLE task_followup_events DROP CONSTRAINT task_followup_events_status_check;
ALTER TABLE task_followup_events ADD CONSTRAINT task_followup_events_status_check
 CHECK (status IN ('new','seen','undone','answered','pending','dismissed'));
INSERT INTO schema_migrations(version) VALUES(18);
