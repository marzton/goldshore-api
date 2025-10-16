CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  org TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  owner TEXT,
  kind TEXT,
  params TEXT,
  r2_key TEXT,
  status TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS backtests (
  id TEXT PRIMARY KEY,
  owner TEXT,
  strategy TEXT,
  params TEXT,
  r2_key TEXT,
  status TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS usage (
  day TEXT,
  owner TEXT,
  metric TEXT,
  value INTEGER DEFAULT 0,
  PRIMARY KEY(day, owner, metric)
);
