BEGIN;

ALTER TABLE auth_login_sessions
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS login_url TEXT,
  ADD COLUMN IF NOT EXISTS poll_token_value VARCHAR(255),
  ADD COLUMN IF NOT EXISTS exchange_token_value VARCHAR(255);

ALTER TABLE auth_email_codes
  ADD COLUMN IF NOT EXISTS code_value VARCHAR(64),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  id BIGSERIAL PRIMARY KEY,
  state_uid VARCHAR(64) NOT NULL UNIQUE,
  provider VARCHAR(32) NOT NULL,
  state_value VARCHAR(255) NOT NULL UNIQUE,
  login_session_uid VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_oauth_states_provider_expires_at
  ON auth_oauth_states (provider, expires_at DESC);

CREATE TABLE IF NOT EXISTS auth_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_uid VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  refresh_token_uid VARCHAR(64) REFERENCES auth_refresh_tokens(token_uid),
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  client_type VARCHAR(32),
  plugin_channel VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_user_id
  ON auth_access_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_access_tokens_expires_at
  ON auth_access_tokens (expires_at);

DROP TRIGGER IF EXISTS trg_auth_access_tokens_set_updated_at ON auth_access_tokens;
CREATE TRIGGER trg_auth_access_tokens_set_updated_at
BEFORE UPDATE ON auth_access_tokens
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
