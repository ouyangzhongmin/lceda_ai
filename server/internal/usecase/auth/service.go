package auth

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	domainauth "lceda_ai/server/internal/domain/auth"
	"lceda_ai/server/internal/pkg/idgen"
)

var (
	ErrSessionNotFound    = domainauth.ErrSessionNotFound
	ErrInvalidPollToken   = domainauth.ErrInvalidPollToken
	ErrInvalidCode        = domainauth.ErrInvalidCode
	ErrInvalidExchange    = domainauth.ErrInvalidExchange
	ErrSessionNotReady    = domainauth.ErrSessionNotReady
	ErrSessionExpired     = domainauth.ErrSessionExpired
	ErrAccessTokenFailed  = domainauth.ErrAccessTokenFailed
	ErrRefreshTokenFailed = domainauth.ErrRefreshTokenFailed
)

type LoginSession = domainauth.LoginSession
type TokenPair = domainauth.TokenPair
type User = domainauth.User
type RefreshSession = domainauth.TokenSession

type Service struct {
	repo         domainauth.Repository
	wechatClient domainauth.WechatProvider
	emailSender  domainauth.EmailCodeSender
}

func NewService(repo domainauth.Repository, wechatClient domainauth.WechatProvider, emailSender ...domainauth.EmailCodeSender) *Service {
	var sender domainauth.EmailCodeSender
	if len(emailSender) > 0 {
		sender = emailSender[0]
	}
	return &Service{
		repo:         repo,
		wechatClient: wechatClient,
		emailSender:  sender,
	}
}

func (s *Service) CreateLoginSession(baseURL string) (*LoginSession, error) {
	session := LoginSession{
		LoginSessionID: idgen.New("ls"),
		PollToken:      idgen.New("pt"),
		Status:         "pending",
		ExpiresAt:      time.Now().Add(5 * 24 * 30 * time.Hour), //5个月
	}
	session.LoginURL = baseURL + "/login?session=" + session.LoginSessionID + "&poll_token=" + session.PollToken
	if err := s.repo.SaveLoginSession(session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Service) GetLoginSession(sessionID, pollToken string) (*LoginSession, error) {
	return s.GetLoginSessionWithWait(sessionID, pollToken, 0)
}

func (s *Service) GetLoginSessionWithWait(sessionID, pollToken string, waitSeconds int) (*LoginSession, error) {
	if waitSeconds < 0 {
		waitSeconds = 0
	}
	if waitSeconds > 20 {
		waitSeconds = 20
	}
	deadline := time.Now().Add(time.Duration(waitSeconds) * time.Second)
	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if session.PollToken != pollToken {
		return nil, ErrInvalidPollToken
	}
	if time.Now().After(session.ExpiresAt) {
		session.Status = "expired"
		if err := s.repo.SaveLoginSession(session); err != nil {
			return nil, err
		}
		return &session, nil
	}
	if session.Status != "pending" || waitSeconds == 0 {
		return &session, nil
	}
	for time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
		session, ok = s.repo.FindLoginSession(sessionID)
		if !ok {
			return nil, ErrSessionNotFound
		}
		if session.PollToken != pollToken {
			return nil, ErrInvalidPollToken
		}
		if time.Now().After(session.ExpiresAt) {
			session.Status = "expired"
			if err := s.repo.SaveLoginSession(session); err != nil {
				return nil, err
			}
			return &session, nil
		}
		if session.Status != "pending" {
			return &session, nil
		}
	}

	return &session, nil
}

func (s *Service) SendEmailCode(sessionID, email string) error {
	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	session.Email = email
	if err := s.repo.SaveLoginSession(session); err != nil {
		return err
	}
	code, err := generateEmailCode()
	if err != nil {
		return err
	}
	if err := s.repo.SaveEmailCode(sessionID, code); err != nil {
		return err
	}
	if s.emailSender != nil {
		if err := s.emailSender.SendLoginCode(email, code); err != nil {
			return err
		}
	}
	return nil
}

func generateEmailCode() (string, error) {
	var value uint32
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	value = uint32(buf[0])<<24 | uint32(buf[1])<<16 | uint32(buf[2])<<8 | uint32(buf[3])
	return fmt.Sprintf("%06d", value%1000000), nil
}

func (s *Service) VerifyEmailCode(sessionID, email, code string) (*LoginSession, error) {
	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if time.Now().After(session.ExpiresAt) {
		session.Status = "expired"
		if err := s.repo.SaveLoginSession(session); err != nil {
			return nil, err
		}
		return nil, ErrSessionExpired
	}
	if session.Email != email {
		return nil, ErrInvalidCode
	}
	if expected, ok := s.repo.FindEmailCode(sessionID); !ok || expected != code {
		return nil, ErrInvalidCode
	}

	user, ok := s.repo.FindUserByEmail(email)
	if !ok {
		user = User{
			UserID:        idgen.New("usr"),
			Email:         email,
			DisplayName:   email,
			EmailVerified: true,
			WechatBound:   false,
			UserType:      "personal",
			CreatedAt:     time.Now(),
		}
		if err := s.repo.SaveUser(user); err != nil {
			return nil, err
		}
	}

	session.Status = "success"
	session.ExchangeToken = idgen.New("et")
	if err := s.repo.SaveLoginSession(session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Service) BuildWechatAuthorizeURL(sessionID string) (string, string, error) {
	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return "", "", ErrSessionNotFound
	}
	if time.Now().After(session.ExpiresAt) {
		session.Status = "expired"
		if err := s.repo.SaveLoginSession(session); err != nil {
			return "", "", err
		}
		return "", "", ErrSessionExpired
	}

	state := idgen.New("wxst")
	if err := s.repo.SaveWechatState(state, sessionID); err != nil {
		return "", "", err
	}
	return s.wechatClient.BuildAuthorizeURL(state), state, nil
}

func (s *Service) CompleteWechatLogin(state, wechatCode string) (*LoginSession, error) {
	sessionID, ok := s.repo.ConsumeWechatState(state)
	if !ok {
		return nil, ErrSessionNotFound
	}

	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if time.Now().After(session.ExpiresAt) {
		session.Status = "expired"
		if err := s.repo.SaveLoginSession(session); err != nil {
			return nil, err
		}
		return nil, ErrSessionExpired
	}

	wechatProfile, err := s.wechatClient.ResolveUserByCode(wechatCode)
	if err != nil {
		return nil, err
	}
	wechatUID := strings.TrimSpace(wechatProfile.UnionID)
	if wechatUID == "" {
		wechatUID = strings.TrimSpace(wechatProfile.OpenID)
	}

	user, ok := s.repo.FindUserByWechatID(wechatUID)
	if !ok {
		user = User{
			UserID:        idgen.New("usr"),
			Email:         "wechat+" + wechatUID + "@placeholder.local",
			DisplayName:   wechatProfile.DisplayName,
			EmailVerified: false,
			WechatBound:   true,
			UserType:      "personal",
			CreatedAt:     time.Now(),
		}
		if err := s.repo.SaveWechatUser(wechatUID, user); err != nil {
			return nil, err
		}
	} else {
		if err := s.repo.SaveUser(user); err != nil {
			return nil, err
		}
	}

	session.Email = user.Email
	session.Status = "success"
	session.ExchangeToken = idgen.New("et")
	if err := s.repo.SaveLoginSession(session); err != nil {
		return nil, err
	}
	return &session, nil
}

func (s *Service) ExchangeToken(sessionID, exchangeToken string) (User, TokenPair, error) {
	session, ok := s.repo.FindLoginSession(sessionID)
	if !ok {
		return User{}, TokenPair{}, ErrSessionNotFound
	}
	if session.Status != "success" {
		return User{}, TokenPair{}, ErrSessionNotReady
	}
	if session.ExchangeToken != exchangeToken {
		return User{}, TokenPair{}, ErrInvalidExchange
	}

	user, ok := s.repo.FindUserByEmail(session.Email)
	if !ok {
		return User{}, TokenPair{}, ErrSessionNotFound
	}

	token := s.issueTokenPair(user)
	if token.AccessToken == "" || token.RefreshToken == "" {
		return User{}, TokenPair{}, ErrAccessTokenFailed
	}
	session.ExchangeToken = ""
	if err := s.repo.SaveLoginSession(session); err != nil {
		return User{}, TokenPair{}, err
	}
	return user, token, nil
}

func (s *Service) RefreshToken(refreshToken string) (User, TokenPair, error) {
	session, ok := s.repo.FindTokenSessionByRefreshToken(refreshToken)
	if !ok {
		return User{}, TokenPair{}, ErrRefreshTokenFailed
	}

	if err := s.repo.DeleteTokenSessionByAccessToken(session.Token.AccessToken); err != nil {
		return User{}, TokenPair{}, err
	}
	if err := s.repo.DeleteTokenSessionByRefreshToken(refreshToken); err != nil {
		return User{}, TokenPair{}, err
	}
	newToken := s.issueTokenPair(session.User)
	if newToken.AccessToken == "" || newToken.RefreshToken == "" {
		return User{}, TokenPair{}, ErrRefreshTokenFailed
	}
	return session.User, newToken, nil
}

func (s *Service) GetUserByAccessToken(accessToken string) (User, error) {
	session, ok := s.repo.FindTokenSessionByAccessToken(accessToken)
	if !ok {
		return User{}, ErrAccessTokenFailed
	}
	return session.User, nil
}

func (s *Service) Logout(accessToken string, allDevices bool) error {
	session, ok := s.repo.FindTokenSessionByAccessToken(accessToken)
	if !ok {
		return ErrAccessTokenFailed
	}

	if allDevices {
		return s.repo.DeleteUserTokenSessions(session.User.UserID)
	}

	if err := s.repo.DeleteTokenSessionByAccessToken(accessToken); err != nil {
		return err
	}
	return s.repo.DeleteTokenSessionByRefreshToken(session.Token.RefreshToken)
}

func (s *Service) BindWechat(accessToken, bindTicket string) (User, error) {
	session, ok := s.repo.FindTokenSessionByAccessToken(accessToken)
	if !ok {
		return User{}, ErrAccessTokenFailed
	}

	wechatUID := "wx_" + bindTicket
	user := session.User
	user.WechatBound = true
	if err := s.repo.SaveUser(user); err != nil {
		return User{}, err
	}
	if err := s.repo.SaveWechatUser(wechatUID, user); err != nil {
		return User{}, err
	}
	if err := s.repo.SaveTokenSession(RefreshSession{
		User:  user,
		Token: session.Token,
	}); err != nil {
		return User{}, err
	}
	return user, nil
}

func (s *Service) issueTokenPair(user User) TokenPair {
	token := TokenPair{
		AccessToken:      idgen.New("atk"),
		RefreshToken:     idgen.New("rtk"),
		ExpiresIn:        3600,              // 1 hour (matches accessTokenTTL in auth.go)
		RefreshExpiresIn: 30 * 24 * 60 * 60, // 30 days (matches refreshTokenTTL in auth.go)
	}
	if err := s.repo.SaveTokenSession(RefreshSession{
		User:  user,
		Token: token,
	}); err != nil {
		return TokenPair{}
	}
	return token
}
