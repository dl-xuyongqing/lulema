CREATE TABLE IF NOT EXISTS records (
  owner_id TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT CHECK (status IN ('clear', 'reset') OR status IS NULL),
  occurred_at TEXT,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, day)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS recovery (
  owner_id TEXT PRIMARY KEY NOT NULL,
  start TEXT,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL
) WITHOUT ROWID;
