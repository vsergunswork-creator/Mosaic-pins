-- Step52: immutable customer invoice snapshots.
-- The runtime endpoint also creates this table automatically, so a manual D1
-- migration is not required for existing deployments.
CREATE TABLE IF NOT EXISTS account_invoices (
  id TEXT PRIMARY KEY,
  order_key TEXT NOT NULL UNIQUE,
  airtable_record_id TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL UNIQUE,
  customer_email TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  invoice_json TEXT NOT NULL,
  airtable_uploaded_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_invoices_email
  ON account_invoices(customer_email);
