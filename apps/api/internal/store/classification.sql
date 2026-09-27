CREATE TABLE money_categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 hidden boolean NOT NULL DEFAULT false, version bigint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX money_category_name ON money_categories(lower(name));
INSERT INTO money_categories(name) VALUES ('Recurring'),('Everyday'),('Occasional');
CREATE TABLE money_tags (key text PRIMARY KEY, name text NOT NULL);
INSERT INTO money_tags(key,name) VALUES
 ('health','Health'),('fitness','Fitness'),('home','Home'),('groceries','Groceries'),
 ('dining','Dining'),('transport','Transport'),('travel','Travel'),
 ('entertainment','Entertainment'),('electronics','Electronics'),
 ('salary','Salary'),('refund','Refund'),('interest','Interest');
ALTER TABLE entries ADD COLUMN category_id uuid REFERENCES money_categories(id);
UPDATE entries e SET category_id=c.id FROM money_categories c WHERE lower(trim(e.category))=lower(c.name);
ALTER TABLE entries ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE bank_ledger_transactions ADD COLUMN category_id uuid REFERENCES money_categories(id);
ALTER TABLE bank_ledger_transactions ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE bank_ledger_transactions ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE bank_ledger_transactions ADD COLUMN annotation_version bigint NOT NULL DEFAULT 1;
INSERT INTO schema_migrations(version) VALUES(4);
