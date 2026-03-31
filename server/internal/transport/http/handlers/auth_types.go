package handlers

type sendEmailCodeRequest struct {
	LoginSessionID string `json:"login_session_id"`
	Email          string `json:"email"`
	Scene          string `json:"scene"`
}

type verifyEmailCodeRequest struct {
	LoginSessionID string `json:"login_session_id"`
	Email          string `json:"email"`
	Code           string `json:"code"`
}

type tokenActionRequest struct {
	Action string `json:"action"`
}

type exchangeTokenRequest struct {
	LoginSessionID string `json:"login_session_id"`
	ExchangeToken  string `json:"exchange_token"`
}

type refreshTokenRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type logoutRequest struct {
	AllDevices bool `json:"all_devices"`
}

type wechatLoginURLRequest struct {
	LoginSessionID string `json:"login_session_id"`
}

type wechatBindRequest struct {
	BindTicket string `json:"bind_ticket"`
}
