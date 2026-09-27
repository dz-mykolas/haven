CREATE INDEX assistant_reviews_pending_cursor ON assistant_reviews ((original->>'date') DESC,created_at DESC,entry_id) WHERE status='review';
CREATE INDEX assistant_reviews_history_cursor ON assistant_reviews ((original->>'date') DESC,created_at DESC,entry_id) WHERE status IN ('dismissed','completed','unchanged','stale','auto_applied','undone');
CREATE INDEX bank_ledger_booking_date ON bank_ledger_transactions ((payload->>'booking_date'));
CREATE INDEX entries_activity_cursor ON entries (date DESC,id) WHERE NOT deleted;
INSERT INTO schema_migrations(version) VALUES(14);
