-- Mosaic Pins order item purchase snapshots
-- Stores the exact product data used at payment time for future My Orders / Verified Purchase.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS order_item_snapshots (
  id TEXT PRIMARY KEY,
  order_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  product_record_id TEXT,
  pin TEXT NOT NULL,
  title TEXT NOT NULL,
  image TEXT,
  diameter REAL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_key, pin)
);

CREATE INDEX IF NOT EXISTS idx_order_item_snapshots_order
  ON order_item_snapshots(order_key);

CREATE INDEX IF NOT EXISTS idx_order_item_snapshots_product
  ON order_item_snapshots(product_record_id);

CREATE INDEX IF NOT EXISTS idx_order_item_snapshots_pin
  ON order_item_snapshots(pin);
