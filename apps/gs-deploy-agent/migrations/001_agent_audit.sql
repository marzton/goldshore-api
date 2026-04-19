-- gs-deploy-agent audit table
-- Run: wrangler d1 execute gs_audit_db --file=migrations/001_agent_audit.sql

CREATE TABLE IF NOT EXISTS agent_audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  action      TEXT    NOT NULL,
  repo        TEXT,
  branch      TEXT,
  script_name TEXT,
  result      TEXT    NOT NULL CHECK (result IN ('ok', 'error')),
  detail      TEXT,
  created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_ts     ON agent_audit (ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_action ON agent_audit (action);
CREATE INDEX IF NOT EXISTS idx_agent_audit_repo   ON agent_audit (repo);
