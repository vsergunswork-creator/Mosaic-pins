CREATE TABLE IF NOT EXISTS content_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  category TEXT NOT NULL,
  content_type TEXT NOT NULL,
  theme TEXT NOT NULL,
  topic TEXT NOT NULL,
  en_text TEXT NOT NULL,
  ru_text TEXT NOT NULL,
  research_summary_ru TEXT,
  source_json TEXT NOT NULL DEFAULT '[]',
  telegram_message_id INTEGER,
  openai_response_id TEXT,
  rewrite_count INTEGER NOT NULL DEFAULT 0,
  trigger_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_posts_created_at
  ON content_posts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_posts_status
  ON content_posts(status);

CREATE INDEX IF NOT EXISTS idx_content_posts_type_theme
  ON content_posts(content_type, theme);
