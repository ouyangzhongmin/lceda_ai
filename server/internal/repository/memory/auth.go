package memory

import (
	"sync"

	domainauth "lceda_ai/server/internal/domain/auth"
)

type AuthRepository struct {
	mu             sync.RWMutex
	sessions       map[string]domainauth.LoginSession
	codes          map[string]string
	usersByEmail   map[string]domainauth.User
	usersByWechat  map[string]domainauth.User
	wechatStates   map[string]string
	accessSessions map[string]domainauth.TokenSession
	refreshIndex   map[string]domainauth.TokenSession
}

func NewAuthRepository() *AuthRepository {
	return &AuthRepository{
		sessions:       make(map[string]domainauth.LoginSession),
		codes:          make(map[string]string),
		usersByEmail:   make(map[string]domainauth.User),
		usersByWechat:  make(map[string]domainauth.User),
		wechatStates:   make(map[string]string),
		accessSessions: make(map[string]domainauth.TokenSession),
		refreshIndex:   make(map[string]domainauth.TokenSession),
	}
}

func (r *AuthRepository) SaveLoginSession(session domainauth.LoginSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[session.LoginSessionID] = session
	return nil
}

func (r *AuthRepository) FindLoginSession(sessionID string) (domainauth.LoginSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	session, ok := r.sessions[sessionID]
	return session, ok
}

func (r *AuthRepository) SaveEmailCode(sessionID, code string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.codes[sessionID] = code
	return nil
}

func (r *AuthRepository) FindEmailCode(sessionID string) (string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	code, ok := r.codes[sessionID]
	return code, ok
}

func (r *AuthRepository) SaveUser(user domainauth.User) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.usersByEmail[user.Email] = user
	return nil
}

func (r *AuthRepository) FindUserByEmail(email string) (domainauth.User, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	user, ok := r.usersByEmail[email]
	return user, ok
}

func (r *AuthRepository) SaveWechatUser(wechatUID string, user domainauth.User) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.usersByWechat[wechatUID] = user
	r.usersByEmail[user.Email] = user
	return nil
}

func (r *AuthRepository) FindUserByWechatID(wechatUID string) (domainauth.User, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	user, ok := r.usersByWechat[wechatUID]
	return user, ok
}

func (r *AuthRepository) SaveWechatState(state, sessionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.wechatStates[state] = sessionID
	return nil
}

func (r *AuthRepository) ConsumeWechatState(state string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	sessionID, ok := r.wechatStates[state]
	if ok {
		delete(r.wechatStates, state)
	}
	return sessionID, ok
}

func (r *AuthRepository) SaveTokenSession(session domainauth.TokenSession) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.accessSessions[session.Token.AccessToken] = session
	r.refreshIndex[session.Token.RefreshToken] = session
	return nil
}

func (r *AuthRepository) FindTokenSessionByAccessToken(accessToken string) (domainauth.TokenSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	session, ok := r.accessSessions[accessToken]
	return session, ok
}

func (r *AuthRepository) FindTokenSessionByRefreshToken(refreshToken string) (domainauth.TokenSession, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	session, ok := r.refreshIndex[refreshToken]
	return session, ok
}

func (r *AuthRepository) DeleteTokenSessionByAccessToken(accessToken string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.accessSessions[accessToken]
	if ok {
		delete(r.refreshIndex, session.Token.RefreshToken)
	}
	delete(r.accessSessions, accessToken)
	return nil
}

func (r *AuthRepository) DeleteTokenSessionByRefreshToken(refreshToken string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	session, ok := r.refreshIndex[refreshToken]
	if ok {
		delete(r.accessSessions, session.Token.AccessToken)
	}
	delete(r.refreshIndex, refreshToken)
	return nil
}

func (r *AuthRepository) DeleteUserTokenSessions(userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for accessToken, session := range r.accessSessions {
		if session.User.UserID == userID {
			delete(r.accessSessions, accessToken)
		}
	}
	for refreshToken, session := range r.refreshIndex {
		if session.User.UserID == userID {
			delete(r.refreshIndex, refreshToken)
		}
	}
	return nil
}
