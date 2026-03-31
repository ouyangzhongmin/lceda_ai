package persistence

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	domainauth "lceda_ai/server/internal/domain/auth"
	"lceda_ai/server/internal/pkg/idgen"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	redisv9 "github.com/redis/go-redis/v9"
)

const (
	loginSessionTTL = 10 * time.Minute    // 登录流程超时：10分钟
	emailCodeTTL    = 5 * time.Minute     // 邮箱验证码：5分钟
	wechatStateTTL  = 10 * time.Minute    // 微信 OAuth state：10分钟
	accessTokenTTL  = 1 * time.Hour       // Access Token：1小时
	refreshTokenTTL = 30 * 24 * time.Hour // Refresh Token：7天
)

type AuthRepository struct {
	pool      *pgxpool.Pool
	redis     *redisv9.Client
	wechatApp string
}

func NewAuthRepository(pool *pgxpool.Pool, redis *redisv9.Client, wechatApp string) *AuthRepository {
	return &AuthRepository{
		pool:      pool,
		redis:     redis,
		wechatApp: wechatApp,
	}
}

func (r *AuthRepository) SaveLoginSession(session domainauth.LoginSession) error {
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := r.pool.Exec(ctx, `
			INSERT INTO auth_login_sessions (
				login_session_uid, status, poll_token_hash, exchange_token_hash,
				poll_token_value, exchange_token_value, email, login_url, expires_at, created_at, updated_at
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
			)
			ON CONFLICT (login_session_uid) DO UPDATE
			SET status = EXCLUDED.status,
			    poll_token_hash = EXCLUDED.poll_token_hash,
			    exchange_token_hash = EXCLUDED.exchange_token_hash,
			    poll_token_value = EXCLUDED.poll_token_value,
			    exchange_token_value = EXCLUDED.exchange_token_value,
			    email = EXCLUDED.email,
			    login_url = EXCLUDED.login_url,
			    expires_at = EXCLUDED.expires_at,
			    updated_at = NOW()
		`, session.LoginSessionID, session.Status, hashToken(session.PollToken), nullableString(session.ExchangeToken),
			session.PollToken, nullableString(session.ExchangeToken), nullableString(session.Email), nullableString(session.LoginURL), session.ExpiresAt)
		if err != nil {
			return err
		}
	}
	if r.redis != nil {
		return r.setJSON(context.Background(), keyLoginSession(session.LoginSessionID), session, loginSessionTTL)
	}
	return nil
}

func (r *AuthRepository) FindLoginSession(sessionID string) (domainauth.LoginSession, bool) {
	if r.redis != nil {
		var session domainauth.LoginSession
		ok := r.getJSON(context.Background(), keyLoginSession(sessionID), &session)
		if ok {
			return session, true
		}
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var session domainauth.LoginSession
		err := r.pool.QueryRow(ctx, `
			SELECT login_session_uid, COALESCE(poll_token_value, ''), COALESCE(login_url, ''), status,
			       COALESCE(email, ''), COALESCE(exchange_token_value, ''), expires_at
			FROM auth_login_sessions
			WHERE login_session_uid = $1
			LIMIT 1
		`, sessionID).Scan(
			&session.LoginSessionID,
			&session.PollToken,
			&session.LoginURL,
			&session.Status,
			&session.Email,
			&session.ExchangeToken,
			&session.ExpiresAt,
		)
		if err == nil {
			if r.redis != nil {
				_ = r.setJSON(context.Background(), keyLoginSession(session.LoginSessionID), session, loginSessionTTL)
			}
			return session, true
		}
	}
	var session domainauth.LoginSession
	return session, false
}

func (r *AuthRepository) SaveEmailCode(sessionID, code string) error {
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var email string
		_ = r.pool.QueryRow(ctx, `
			SELECT COALESCE(email, '')
			FROM auth_login_sessions
			WHERE login_session_uid = $1
			LIMIT 1
		`, sessionID).Scan(&email)
		_, err := r.pool.Exec(ctx, `
			INSERT INTO auth_email_codes (
				record_uid, email, scene, login_session_uid, status, code_value, sent_at, expires_at, created_at
			) VALUES (
				$1, $2, 'login', $3, 'sent', $4, NOW(), NOW() + INTERVAL '5 minutes', NOW()
			)
		`, idgen.New("emc"), nonEmptyOr(email, "unknown@example.local"), sessionID, code)
		if err != nil {
			return err
		}
	}
	if r.redis != nil {
		return r.redis.Set(context.Background(), keyEmailCode(sessionID), code, emailCodeTTL).Err()
	}
	return nil
}

func (r *AuthRepository) FindEmailCode(sessionID string) (string, bool) {
	if r.redis != nil {
		value, err := r.redis.Get(context.Background(), keyEmailCode(sessionID)).Result()
		if err == nil {
			return value, true
		}
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var code string
		err := r.pool.QueryRow(ctx, `
			SELECT COALESCE(code_value, '')
			FROM auth_email_codes
			WHERE login_session_uid = $1 AND status = 'sent' AND (expires_at IS NULL OR expires_at > NOW())
			ORDER BY sent_at DESC
			LIMIT 1
		`, sessionID).Scan(&code)
		if err == nil && code != "" {
			if r.redis != nil {
				_ = r.redis.Set(context.Background(), keyEmailCode(sessionID), code, emailCodeTTL).Err()
			}
			return code, true
		}
	}
	return "", false
}

func (r *AuthRepository) SaveUser(user domainauth.User) error {
	if r.pool == nil {
		return errors.New("postgres pool is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var id int64
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (user_uid, display_name, email, email_verified, user_type, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
		ON CONFLICT (user_uid) DO UPDATE
		SET display_name = EXCLUDED.display_name,
		    email = EXCLUDED.email,
		    email_verified = EXCLUDED.email_verified,
		    user_type = EXCLUDED.user_type,
		    updated_at = NOW()
		RETURNING id
	`, user.UserID, user.DisplayName, nullableString(user.Email), user.EmailVerified, nonEmptyOr(user.UserType, "personal")).Scan(&id)
	if err != nil {
		return err
	}

	if user.Email != "" {
		_, err = r.pool.Exec(ctx, `
			INSERT INTO user_auth_identities (identity_uid, user_id, provider, provider_subject, is_primary, verified, created_at, updated_at)
			VALUES ($1, $2, 'email', $3, true, $4, NOW(), NOW())
			ON CONFLICT (provider, provider_subject) DO UPDATE
			SET user_id = EXCLUDED.user_id,
			    verified = EXCLUDED.verified,
			    updated_at = NOW()
		`, idgen.New("ida"), id, user.Email, user.EmailVerified)
		if err != nil {
			return err
		}
	}

	return nil
}

func (r *AuthRepository) FindUserByEmail(email string) (domainauth.User, bool) {
	if r.pool == nil {
		return domainauth.User{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	user, err := queryUserBy(ctx, r.pool, "u.email = $1", email)
	if err != nil {
		return domainauth.User{}, false
	}
	return user, true
}

func (r *AuthRepository) SaveWechatUser(wechatUID string, user domainauth.User) error {
	if err := r.SaveUser(user); err != nil {
		return err
	}
	if r.pool == nil {
		return errors.New("postgres pool is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var userID int64
	if err := r.pool.QueryRow(ctx, `SELECT id FROM users WHERE user_uid = $1`, user.UserID).Scan(&userID); err != nil {
		return err
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_auth_identities (identity_uid, user_id, provider, provider_subject, is_primary, verified, created_at, updated_at)
		VALUES ($1, $2, 'wechat_unionid', $3, false, true, NOW(), NOW())
		ON CONFLICT (provider, provider_subject) DO UPDATE
		SET user_id = EXCLUDED.user_id,
		    verified = true,
		    updated_at = NOW()
	`, idgen.New("ida"), userID, wechatUID)
	if err != nil {
		return err
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO auth_wechat_bindings (binding_uid, user_id, app_id, unionid, nickname, status, bound_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'bound', NOW(), NOW(), NOW())
		ON CONFLICT (binding_uid) DO NOTHING
	`, idgen.New("wxb"), userID, nonEmptyOr(r.wechatApp, "mock_appid"), wechatUID, nullableString(user.DisplayName))
	return err
}

func (r *AuthRepository) FindUserByWechatID(wechatUID string) (domainauth.User, bool) {
	if r.pool == nil {
		return domainauth.User{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	user, err := queryUserBy(ctx, r.pool, "idn.provider = 'wechat_unionid' AND idn.provider_subject = $1", wechatUID)
	if err != nil {
		return domainauth.User{}, false
	}
	return user, true
}

func (r *AuthRepository) SaveWechatState(state, sessionID string) error {
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := r.pool.Exec(ctx, `
			INSERT INTO auth_oauth_states (state_uid, provider, state_value, login_session_uid, expires_at, created_at)
			VALUES ($1, 'wechat', $2, $3, NOW() + INTERVAL '10 minutes', NOW())
			ON CONFLICT (state_value) DO UPDATE
			SET login_session_uid = EXCLUDED.login_session_uid,
			    expires_at = EXCLUDED.expires_at,
			    consumed_at = NULL
		`, idgen.New("st"), state, sessionID)
		if err != nil {
			return err
		}
	}
	if r.redis != nil {
		return r.redis.Set(context.Background(), keyWechatState(state), sessionID, wechatStateTTL).Err()
	}
	return nil
}

func (r *AuthRepository) ConsumeWechatState(state string) (string, bool) {
	if r.redis != nil {
		ctx := context.Background()
		value, err := r.redis.GetDel(ctx, keyWechatState(state)).Result()
		if err == nil {
			return value, true
		}
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var sessionID string
		err := r.pool.QueryRow(ctx, `
			UPDATE auth_oauth_states
			SET consumed_at = NOW()
			WHERE state_value = $1 AND provider = 'wechat' AND consumed_at IS NULL AND expires_at > NOW()
			RETURNING login_session_uid
		`, state).Scan(&sessionID)
		if err == nil {
			return sessionID, true
		}
	}
	return "", false
}

func (r *AuthRepository) SaveTokenSession(session domainauth.TokenSession) error {
	if r.pool == nil {
		return errors.New("auth repository dependencies are not initialized")
	}

	if err := r.SaveUser(session.User); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var userID int64
	if err := r.pool.QueryRow(ctx, `SELECT id FROM users WHERE user_uid = $1`, session.User.UserID).Scan(&userID); err != nil {
		return err
	}

	refreshTokenUID := idgen.New("rts")
	refreshTokenHash := hashToken(session.Token.RefreshToken)
	accessTokenHash := hashToken(session.Token.AccessToken)
	_, err := r.pool.Exec(ctx, `
		UPDATE auth_refresh_tokens
		SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
		WHERE token_hash = $1 AND status = 'active'
	`, refreshTokenHash)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `
		INSERT INTO auth_refresh_tokens (token_uid, user_id, token_hash, client_type, plugin_channel, status, expires_at, created_at, updated_at)
		VALUES ($1, $2, $3, 'lceda_plugin', 'standard', 'active', NOW() + INTERVAL '7 days', NOW(), NOW())
		ON CONFLICT (token_uid) DO UPDATE
		SET token_hash = EXCLUDED.token_hash,
		    status = 'active',
		    expires_at = EXCLUDED.expires_at,
		    updated_at = NOW()
	`, refreshTokenUID, userID, refreshTokenHash)
	if err != nil {
		return err
	}

	_, err = r.pool.Exec(ctx, `
		UPDATE auth_access_tokens
		SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
		WHERE token_hash = $1 AND status = 'active'
	`, accessTokenHash)
	if err != nil {
		return err
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO auth_access_tokens (
			token_uid, user_id, refresh_token_uid, token_hash, client_type, plugin_channel, status, expires_at, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, 'lceda_plugin', 'standard', 'active', NOW() + INTERVAL '1 hour', NOW(), NOW()
		)
	`, idgen.New("ats"), userID, refreshTokenUID, accessTokenHash)
	if err != nil {
		return err
	}
	if r.redis != nil {
		if err := r.setJSON(ctx, keyAccessToken(session.Token.AccessToken), session, accessTokenTTL); err != nil {
			return err
		}
		if err := r.setJSON(ctx, keyRefreshToken(session.Token.RefreshToken), session, refreshTokenTTL); err != nil {
			return err
		}
	}
	return nil
}

func (r *AuthRepository) FindTokenSessionByAccessToken(accessToken string) (domainauth.TokenSession, bool) {
	if r.redis != nil {
		var session domainauth.TokenSession
		ok := r.getJSON(context.Background(), keyAccessToken(accessToken), &session)
		if ok {
			return session, true
		}
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		user, expiresAt, err := queryUserByAccessTokenHash(ctx, r.pool, hashToken(accessToken))
		if err == nil {
			return domainauth.TokenSession{
				User: user,
				Token: domainauth.TokenPair{
					AccessToken: accessToken,
					ExpiresIn:   maxInt(int(time.Until(expiresAt).Seconds()), 0),
				},
			}, true
		}
	}
	return domainauth.TokenSession{}, false
}

func (r *AuthRepository) FindTokenSessionByRefreshToken(refreshToken string) (domainauth.TokenSession, bool) {
	var session domainauth.TokenSession
	if r.redis != nil {
		ok := r.getJSON(context.Background(), keyRefreshToken(refreshToken), &session)
		if ok {
			return session, true
		}
	}
	if r.pool == nil {
		return domainauth.TokenSession{}, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	user, expiresAt, err := queryUserByRefreshTokenHash(ctx, r.pool, hashToken(refreshToken))
	if err != nil {
		return domainauth.TokenSession{}, false
	}
	return domainauth.TokenSession{
		User: user,
		Token: domainauth.TokenPair{
			RefreshToken: refreshToken,
			ExpiresIn:    maxInt(int(time.Until(expiresAt).Seconds()), 0),
		},
	}, true
}

func (r *AuthRepository) DeleteTokenSessionByAccessToken(accessToken string) error {
	if accessToken == "" {
		return nil
	}
	if r.redis != nil {
		session, ok := r.FindTokenSessionByAccessToken(accessToken)
		if ok && session.Token.RefreshToken != "" {
			_ = r.redis.Del(context.Background(), keyRefreshToken(session.Token.RefreshToken)).Err()
		}
		_ = r.redis.Del(context.Background(), keyAccessToken(accessToken)).Err()
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		var refreshTokenUID string
		_ = r.pool.QueryRow(ctx, `
			UPDATE auth_access_tokens
			SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
			WHERE token_hash = $1 AND status = 'active'
			RETURNING COALESCE(refresh_token_uid, '')
		`, hashToken(accessToken)).Scan(&refreshTokenUID)
		if refreshTokenUID != "" {
			_, _ = r.pool.Exec(ctx, `
				UPDATE auth_refresh_tokens
				SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
				WHERE token_uid = $1 AND status = 'active'
			`, refreshTokenUID)
		}
	}
	return nil
}

func (r *AuthRepository) DeleteTokenSessionByRefreshToken(refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	if r.redis != nil {
		session, ok := r.FindTokenSessionByRefreshToken(refreshToken)
		if ok && session.Token.AccessToken != "" {
			_ = r.redis.Del(context.Background(), keyAccessToken(session.Token.AccessToken)).Err()
		}
		_ = r.redis.Del(context.Background(), keyRefreshToken(refreshToken)).Err()
	}
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, _ = r.pool.Exec(ctx, `
			UPDATE auth_refresh_tokens
			SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
			WHERE token_hash = $1
		`, hashToken(refreshToken))
		_, _ = r.pool.Exec(ctx, `
			UPDATE auth_access_tokens
			SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
			WHERE refresh_token_uid IN (
				SELECT token_uid FROM auth_refresh_tokens WHERE token_hash = $1
			)
		`, hashToken(refreshToken))
	}
	return nil
}

func (r *AuthRepository) DeleteUserTokenSessions(userID string) error {
	if r.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		rows, err := r.pool.Query(ctx, `
			SELECT rt.token_uid, rt.token_hash
			FROM auth_refresh_tokens rt
			JOIN users u ON u.id = rt.user_id
			WHERE u.user_uid = $1 AND rt.status = 'active'
		`, userID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var tokenUID string
				var refreshTokenHash string
				if rows.Scan(&tokenUID, &refreshTokenHash) == nil {
					if r.redis != nil {
						if session, ok := r.findTokenSessionByRefreshTokenHash(refreshTokenHash); ok {
							_ = r.redis.Del(context.Background(), keyAccessToken(session.Token.AccessToken)).Err()
						}
						_ = r.redis.Del(context.Background(), keyRefreshTokenHash(refreshTokenHash)).Err()
					}
					ctx2, cancel2 := context.WithTimeout(context.Background(), 3*time.Second)
					_, _ = r.pool.Exec(ctx2, `UPDATE auth_refresh_tokens SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE token_uid = $1`, tokenUID)
					_, _ = r.pool.Exec(ctx2, `UPDATE auth_access_tokens SET status = 'revoked', revoked_at = NOW(), updated_at = NOW() WHERE refresh_token_uid = $1`, tokenUID)
					cancel2()
				}
			}
		}
	}
	return nil
}

func (r *AuthRepository) setJSON(ctx context.Context, key string, value any, ttl time.Duration) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return r.redis.Set(ctx, key, payload, ttl).Err()
}

func (r *AuthRepository) getJSON(ctx context.Context, key string, target any) bool {
	raw, err := r.redis.Get(ctx, key).Bytes()
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, target) == nil
}

func keyLoginSession(id string) string { return "auth:login_session:" + id }
func keyEmailCode(id string) string    { return "auth:email_code:session:" + id }
func keyWechatState(id string) string  { return "auth:wechat_state:" + id }
func keyAccessToken(t string) string   { return "auth:access_token:" + hashToken(t) }
func keyRefreshToken(t string) string  { return keyRefreshTokenHash(hashToken(t)) }
func keyRefreshTokenHash(h string) string {
	return "auth:refresh_token:" + h
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func (r *AuthRepository) findTokenSessionByRefreshTokenHash(refreshTokenHash string) (domainauth.TokenSession, bool) {
	var session domainauth.TokenSession
	ok := r.getJSON(context.Background(), keyRefreshTokenHash(refreshTokenHash), &session)
	return session, ok
}

func queryUserBy(ctx context.Context, pool *pgxpool.Pool, predicate string, arg string) (domainauth.User, error) {
	var user domainauth.User
	err := pool.QueryRow(ctx, `
		SELECT u.user_uid, COALESCE(u.email, ''), u.display_name, u.email_verified, u.user_type, u.created_at,
		       EXISTS (
		         SELECT 1 FROM auth_wechat_bindings wb
		         WHERE wb.user_id = u.id AND wb.status = 'bound' AND wb.unbound_at IS NULL
		       ) AS wechat_bound
		FROM users u
		LEFT JOIN user_auth_identities idn ON idn.user_id = u.id
		WHERE `+predicate+`
		LIMIT 1
	`, arg).Scan(&user.UserID, &user.Email, &user.DisplayName, &user.EmailVerified, &user.UserType, &user.CreatedAt, &user.WechatBound)
	return user, err
}

func queryUserByRefreshTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash string) (domainauth.User, time.Time, error) {
	var user domainauth.User
	var expiresAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT u.user_uid, COALESCE(u.email, ''), u.display_name, u.email_verified, u.user_type, u.created_at,
		       EXISTS (
		         SELECT 1 FROM auth_wechat_bindings wb
		         WHERE wb.user_id = u.id AND wb.status = 'bound' AND wb.unbound_at IS NULL
		       ) AS wechat_bound,
		       rt.expires_at
		FROM auth_refresh_tokens rt
		JOIN users u ON u.id = rt.user_id
		WHERE rt.token_hash = $1 AND rt.status = 'active' AND rt.expires_at > NOW()
		LIMIT 1
	`, tokenHash).Scan(&user.UserID, &user.Email, &user.DisplayName, &user.EmailVerified, &user.UserType, &user.CreatedAt, &user.WechatBound, &expiresAt)
	if err == pgx.ErrNoRows {
		return domainauth.User{}, time.Time{}, err
	}
	return user, expiresAt, err
}

func queryUserByAccessTokenHash(ctx context.Context, pool *pgxpool.Pool, tokenHash string) (domainauth.User, time.Time, error) {
	var user domainauth.User
	var expiresAt time.Time
	err := pool.QueryRow(ctx, `
		SELECT u.user_uid, COALESCE(u.email, ''), u.display_name, u.email_verified, u.user_type, u.created_at,
		       EXISTS (
		         SELECT 1 FROM auth_wechat_bindings wb
		         WHERE wb.user_id = u.id AND wb.status = 'bound' AND wb.unbound_at IS NULL
		       ) AS wechat_bound,
		       at.expires_at
		FROM auth_access_tokens at
		JOIN users u ON u.id = at.user_id
		WHERE at.token_hash = $1 AND at.status = 'active' AND at.expires_at > NOW()
		LIMIT 1
	`, tokenHash).Scan(&user.UserID, &user.Email, &user.DisplayName, &user.EmailVerified, &user.UserType, &user.CreatedAt, &user.WechatBound, &expiresAt)
	if err == pgx.ErrNoRows {
		return domainauth.User{}, time.Time{}, err
	}
	return user, expiresAt, err
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nonEmptyOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func maxInt(value, fallback int) int {
	if value < fallback {
		return fallback
	}
	return value
}
