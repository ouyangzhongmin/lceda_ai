package auth

import (
	"errors"
	"time"
)

var (
	ErrSessionNotFound    = errors.New("login session not found")
	ErrInvalidPollToken   = errors.New("invalid poll token")
	ErrInvalidCode        = errors.New("invalid email code")
	ErrInvalidExchange    = errors.New("invalid exchange token")
	ErrSessionNotReady    = errors.New("login session not ready")
	ErrSessionExpired     = errors.New("login session expired")
	ErrAccessTokenFailed  = errors.New("invalid access token")
	ErrRefreshTokenFailed = errors.New("invalid refresh token")
)

type LoginSession struct {
	LoginSessionID string    `json:"login_session_id"`
	PollToken      string    `json:"poll_token"`
	LoginURL       string    `json:"login_url"`
	Status         string    `json:"status"`
	Email          string    `json:"email,omitempty"`
	ExchangeToken  string    `json:"exchange_token,omitempty"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type TokenPair struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	ExpiresIn        int    `json:"expires_in"`         // Access Token 有效期（秒）
	RefreshExpiresIn int    `json:"refresh_expires_in"` // Refresh Token 有效期（秒）
}

type User struct {
	UserID        string    `json:"user_id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	EmailVerified bool      `json:"email_verified"`
	WechatBound   bool      `json:"wechat_bound"`
	UserType      string    `json:"user_type"`
	CreatedAt     time.Time `json:"created_at"`
}

type TokenSession struct {
	User  User
	Token TokenPair
}

type WechatProfile struct {
	UnionID     string
	OpenID      string
	DisplayName string
}

type Repository interface {
	SaveLoginSession(session LoginSession) error
	FindLoginSession(sessionID string) (LoginSession, bool)
	SaveEmailCode(sessionID, code string) error
	FindEmailCode(sessionID string) (string, bool)
	SaveUser(user User) error
	FindUserByEmail(email string) (User, bool)
	SaveWechatUser(wechatUID string, user User) error
	FindUserByWechatID(wechatUID string) (User, bool)
	SaveWechatState(state, sessionID string) error
	ConsumeWechatState(state string) (string, bool)
	SaveTokenSession(session TokenSession) error
	FindTokenSessionByAccessToken(accessToken string) (TokenSession, bool)
	FindTokenSessionByRefreshToken(refreshToken string) (TokenSession, bool)
	DeleteTokenSessionByAccessToken(accessToken string) error
	DeleteTokenSessionByRefreshToken(refreshToken string) error
	DeleteUserTokenSessions(userID string) error
}

type WechatProvider interface {
	BuildAuthorizeURL(state string) string
	ResolveUserByCode(code string) (WechatProfile, error)
}

type EmailCodeSender interface {
	SendLoginCode(to string, code string) error
}
