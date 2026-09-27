-- Routines let missed occurrences lapse. continues_from links a task the
-- assistant created to the one it replaced, so history reads as one chain.
ALTER TABLE tasks ADD COLUMN routine boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN continues_from uuid REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
-- The assistant's reading of a task's notes, kept apart from the task so its
-- writes never collide with the user's revisions.
CREATE TABLE task_followups (
 task_id uuid PRIMARY KEY REFERENCES tasks(id),
 notes text NOT NULL,
 summary text NOT NULL DEFAULT '',
 check_on date,
 status text NOT NULL CHECK(status IN ('reading','ready','checking','waiting','failed','done')),
 error text NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_followups_due ON task_followups(status, available_at);
-- What the assistant did, for the Inbox. "before" restores the previous state on undo.
CREATE TABLE task_followup_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL REFERENCES tasks(id),
 action text NOT NULL CHECK(action IN ('updated','replaced','finished','asked')),
 message text NOT NULL,
 question text NOT NULL DEFAULT '',
 answer text NOT NULL DEFAULT '',
 before jsonb NOT NULL,
 created_task uuid REFERENCES tasks(id),
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','seen','undone','answered')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_followup_events_recent ON task_followup_events(created_at DESC);
SELECT haven_track_changes();
INSERT INTO schema_migrations(version) VALUES(17);
