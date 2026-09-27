CREATE TABLE recurring_payment_links (
 account_id uuid NOT NULL,
 payee_key text NOT NULL,
 task_id uuid NOT NULL REFERENCES tasks(id),
 PRIMARY KEY(account_id,payee_key)
);
ALTER TABLE tasks DROP CONSTRAINT tasks_repeat_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_repeat_check
 CHECK(repeat IN ('none','daily','weekly','monthly','yearly'));
-- Previously accepted Recurring labels need a chance to propose the missing
-- schedule. Keep dismissals and all saved transaction annotations intact.
DELETE FROM assistant_reviews r WHERE r.status IN ('completed','unchanged') AND (
 EXISTS(SELECT 1 FROM entries e JOIN money_categories c ON c.id=e.category_id
        WHERE e.id=r.entry_id AND lower(c.name)='recurring' AND NOT e.deleted)
 OR EXISTS(SELECT 1 FROM bank_ledger_transactions e JOIN money_categories c ON c.id=e.category_id
           WHERE e.id=r.entry_id AND lower(c.name)='recurring')
);
UPDATE assistant_reviews SET status='queued',draft=NULL,reason='',attempts=0,available_at=now(),updated_at=now()
 WHERE status IN ('queued','processing','review','failed','unchanged');
INSERT INTO schema_migrations(version) VALUES(11);
