-- 每条记录独立保存；旧版日记录使用稳定 ID，避免重复导入。
CREATE TABLE IF NOT EXISTS record_entries (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  day TEXT NOT NULL,
  status TEXT CHECK (status IN ('clear', 'reset') OR status IS NULL),
  occurred_at TEXT,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS record_entries_by_day ON record_entries (owner_id, day);

INSERT OR IGNORE INTO record_entries (owner_id, id, day, status, occurred_at, updated_at, mutation_id)
SELECT owner_id, 'day_' || day, day, status, occurred_at, updated_at, mutation_id FROM records;
