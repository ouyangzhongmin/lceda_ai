BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  user_uid VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  email VARCHAR(255),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  user_type VARCHAR(32) NOT NULL DEFAULT 'personal',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  tenant_id VARCHAR(64),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id BIGSERIAL PRIMARY KEY,
  identity_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  provider_app_id VARCHAR(128),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_user_auth_identities_provider_subject UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_id ON user_auth_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_login_sessions (
  id BIGSERIAL PRIMARY KEY,
  login_session_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id),
  client_type VARCHAR(32) NOT NULL DEFAULT 'lceda_plugin',
  plugin_channel VARCHAR(32),
  plugin_version VARCHAR(32),
  platform VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  poll_token_hash VARCHAR(255) NOT NULL,
  exchange_token_hash VARCHAR(255),
  login_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_sessions_status ON auth_login_sessions (status);
CREATE INDEX IF NOT EXISTS idx_auth_login_sessions_expires_at ON auth_login_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_login_sessions_user_id ON auth_login_sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  token_hash VARCHAR(255) NOT NULL,
  client_type VARCHAR(32),
  plugin_channel VARCHAR(32),
  device_fingerprint VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at ON auth_refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS auth_email_codes (
  id BIGSERIAL PRIMARY KEY,
  record_uid VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  scene VARCHAR(32) NOT NULL,
  login_session_uid VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_codes_email_scene ON auth_email_codes (email, scene);
CREATE INDEX IF NOT EXISTS idx_auth_email_codes_login_session_uid ON auth_email_codes (login_session_uid);

CREATE TABLE IF NOT EXISTS auth_wechat_bindings (
  id BIGSERIAL PRIMARY KEY,
  binding_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  app_id VARCHAR(128) NOT NULL,
  unionid VARCHAR(255),
  openid VARCHAR(255),
  nickname VARCHAR(255),
  avatar_url TEXT,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'bound',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_wechat_bindings_user_id ON auth_wechat_bindings (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_wechat_bindings_unionid ON auth_wechat_bindings (unionid);
CREATE INDEX IF NOT EXISTS idx_auth_wechat_bindings_openid ON auth_wechat_bindings (openid);

CREATE TABLE IF NOT EXISTS credit_accounts (
  id BIGSERIAL PRIMARY KEY,
  account_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  balance BIGINT NOT NULL DEFAULT 0,
  frozen_balance BIGINT NOT NULL DEFAULT 0,
  currency VARCHAR(32) NOT NULL DEFAULT 'credits',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_credit_accounts_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_credit_accounts_status ON credit_accounts (status);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id BIGSERIAL PRIMARY KEY,
  transaction_uid VARCHAR(64) NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES credit_accounts(id),
  user_id BIGINT NOT NULL REFERENCES users(id),
  transaction_type VARCHAR(32) NOT NULL,
  scene VARCHAR(64) NOT NULL,
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  related_object_type VARCHAR(64),
  related_object_uid VARCHAR(64),
  idempotency_key VARCHAR(128),
  remark TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_account_id_created_at ON credit_transactions (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id_created_at ON credit_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_idempotency_key ON credit_transactions (idempotency_key);

CREATE TABLE IF NOT EXISTS llm_request_logs (
  id BIGSERIAL PRIMARY KEY,
  request_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id),
  task_uid VARCHAR(64),
  scene VARCHAR(64) NOT NULL,
  billing_mode VARCHAR(32) NOT NULL,
  provider VARCHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  request_tokens INTEGER NOT NULL DEFAULT 0,
  response_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  error_code VARCHAR(64),
  cost_credits BIGINT NOT NULL DEFAULT 0,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_request_logs_user_id_created_at ON llm_request_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_request_logs_task_uid ON llm_request_logs (task_uid);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  task_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  billing_mode VARCHAR(32) NOT NULL,
  plugin_channel VARCHAR(32),
  project_id VARCHAR(128),
  page_id VARCHAR(128),
  user_query TEXT NOT NULL,
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB,
  error_code VARCHAR(64),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_id_created_at ON agent_tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks (status);

CREATE TABLE IF NOT EXISTS agent_tool_traces (
  id BIGSERIAL PRIMARY KEY,
  trace_uid VARCHAR(64) NOT NULL UNIQUE,
  task_id BIGINT NOT NULL REFERENCES agent_tasks(id),
  step_index INTEGER NOT NULL,
  tool_name VARCHAR(128) NOT NULL,
  tool_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_traces_task_id_step_index ON agent_tool_traces (task_id, step_index);

CREATE TABLE IF NOT EXISTS agent_skill_runs (
  id BIGSERIAL PRIMARY KEY,
  run_uid VARCHAR(64) NOT NULL UNIQUE,
  task_id BIGINT NOT NULL REFERENCES agent_tasks(id),
  skill_name VARCHAR(128) NOT NULL,
  skill_version VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skill_runs_task_id_created_at ON agent_skill_runs (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  document_uid VARCHAR(64) NOT NULL UNIQUE,
  kb_type VARCHAR(32) NOT NULL,
  title VARCHAR(500) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_ref VARCHAR(255),
  lang VARCHAR(16) NOT NULL DEFAULT 'zh-CN',
  version VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  object_storage_key VARCHAR(500),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb_type_status ON knowledge_documents (kb_type, status);

CREATE TABLE IF NOT EXISTS knowledge_document_chunks (
  id BIGSERIAL PRIMARY KEY,
  chunk_uid VARCHAR(64) NOT NULL UNIQUE,
  document_id BIGINT NOT NULL REFERENCES knowledge_documents(id),
  qdrant_collection VARCHAR(128) NOT NULL,
  qdrant_point_id VARCHAR(128) NOT NULL,
  chunk_index INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_knowledge_document_chunks_doc_chunk UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_document_chunks_document_id ON knowledge_document_chunks (document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_document_chunks_qdrant_point_id ON knowledge_document_chunks (qdrant_point_id);

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  request_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id),
  path VARCHAR(255) NOT NULL,
  method VARCHAR(16) NOT NULL,
  status_code INTEGER NOT NULL,
  client_ip INET,
  user_agent TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_user_id_created_at ON request_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_path_created_at ON request_logs (path, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limit_records (
  id BIGSERIAL PRIMARY KEY,
  subject_type VARCHAR(32) NOT NULL,
  subject_key VARCHAR(255) NOT NULL,
  rule_name VARCHAR(64) NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_records_subject_triggered_at
  ON rate_limit_records (subject_type, subject_key, triggered_at DESC);

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_auth_identities_set_updated_at ON user_auth_identities;
CREATE TRIGGER trg_user_auth_identities_set_updated_at
BEFORE UPDATE ON user_auth_identities
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_auth_login_sessions_set_updated_at ON auth_login_sessions;
CREATE TRIGGER trg_auth_login_sessions_set_updated_at
BEFORE UPDATE ON auth_login_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_auth_refresh_tokens_set_updated_at ON auth_refresh_tokens;
CREATE TRIGGER trg_auth_refresh_tokens_set_updated_at
BEFORE UPDATE ON auth_refresh_tokens
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_auth_wechat_bindings_set_updated_at ON auth_wechat_bindings;
CREATE TRIGGER trg_auth_wechat_bindings_set_updated_at
BEFORE UPDATE ON auth_wechat_bindings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_credit_accounts_set_updated_at ON credit_accounts;
CREATE TRIGGER trg_credit_accounts_set_updated_at
BEFORE UPDATE ON credit_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_agent_tasks_set_updated_at ON agent_tasks;
CREATE TRIGGER trg_agent_tasks_set_updated_at
BEFORE UPDATE ON agent_tasks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_knowledge_documents_set_updated_at ON knowledge_documents;
CREATE TRIGGER trg_knowledge_documents_set_updated_at
BEFORE UPDATE ON knowledge_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_knowledge_document_chunks_set_updated_at ON knowledge_document_chunks;
CREATE TRIGGER trg_knowledge_document_chunks_set_updated_at
BEFORE UPDATE ON knowledge_document_chunks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
