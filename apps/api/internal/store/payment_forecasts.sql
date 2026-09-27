ALTER TABLE tasks ADD COLUMN plan jsonb;
ALTER TABLE tasks ALTER COLUMN date DROP NOT NULL;
CREATE TABLE transaction_payment_links (
 entry_id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES tasks(id),
 purchased_units integer NOT NULL DEFAULT 0 CHECK(purchased_units BETWEEN 0 AND 100)
);
ALTER TABLE recurring_payment_links DROP CONSTRAINT recurring_payment_links_pkey;
ALTER TABLE recurring_payment_links ADD PRIMARY KEY(account_id,payee_key,task_id);
ALTER TABLE assistant_reviews ADD COLUMN question text NOT NULL DEFAULT '', ADD COLUMN answer text NOT NULL DEFAULT '';
INSERT INTO schema_migrations(version) VALUES(13);
