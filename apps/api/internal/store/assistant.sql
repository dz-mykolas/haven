CREATE TABLE assistant_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 mode text NOT NULL CHECK (mode IN ('manual','on_request','proactive')),
 presentation text NOT NULL CHECK (presentation IN ('button','card')),
 offer_estimated_costs boolean NOT NULL,
 skills jsonb NOT NULL CHECK (jsonb_typeof(skills)='object'),
 version bigint NOT NULL CHECK (version>0)
);
INSERT INTO assistant_settings(singleton, mode, presentation, offer_estimated_costs, skills, version)
VALUES(true, 'manual', 'button', true, '{"review-transaction":true,"plan-task":true,"organize-money":true}', 1);
INSERT INTO schema_migrations(version) VALUES(6);
