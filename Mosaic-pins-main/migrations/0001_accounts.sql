-- Mosaic Pins customer accounts foundation
-- Passwordless accounts: no customer passwords are stored.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT,
  email_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_login_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_login_codes_user
  ON account_login_codes(user_id);

CREATE INDEX IF NOT EXISTS idx_account_login_codes_expires
  ON account_login_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_account_sessions_user
  ON account_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_account_sessions_expires
  ON account_sessions(expires_at);
