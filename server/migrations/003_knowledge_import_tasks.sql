BEGIN;

CREATE TABLE IF NOT EXISTS knowledge_import_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_uid VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedup_key VARCHAR(255),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  document_uid VARCHAR(64),
  import_mode VARCHAR(32),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_knowledge_import_tasks_status_created_at
  ON knowledge_import_tasks (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uk_knowledge_import_tasks_dedup_key
  ON knowledge_import_tasks (dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge_import_dead_letters (
  id BIGSERIAL PRIMARY KEY,
  task_uid VARCHAR(64) NOT NULL,
  error_message TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_import_dead_letters_failed_at
  ON knowledge_import_dead_letters (failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_import_dead_letters_task_uid
  ON knowledge_import_dead_letters (task_uid);

DROP TRIGGER IF EXISTS trg_knowledge_import_tasks_set_updated_at ON knowledge_import_tasks;
CREATE TRIGGER trg_knowledge_import_tasks_set_updated_at
BEFORE UPDATE ON knowledge_import_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
