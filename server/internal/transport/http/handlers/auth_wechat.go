package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func (h *AuthHandler) WechatLoginURL(c *gin.Context) {
	var req wechatLoginURLRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	authorizeURL, state, err := h.service.BuildWechatAuthorizeURL(req.LoginSessionID)
	if err != nil {
		status := http.StatusBadRequest
		code := 401002
		if err != nil && err.Error() != "login session not found" && err.Error() != "login session expired" {
			status = http.StatusInternalServerError
			code = 500000
		}
		ginError(c, status, code, err.Error())
		return
	}
	ginSuccess(c, map[string]any{
		"provider":      "wechat",
		"authorize_url": authorizeURL,
		"state":         state,
	})
}

func (h *AuthHandler) WechatCallback(c *gin.Context) {
	state := c.Query("state")
	code := c.Query("code")
	if state == "" || code == "" {
		ginBadRequest(c, "missing state or code")
		return
	}
	session, err := h.service.CompleteWechatLogin(state, code)
	if err != nil {
		status := http.StatusBadRequest
		codeVal := 401004
		if err.Error() != "login session not found" && err.Error() != "login session expired" {
			status = http.StatusInternalServerError
			codeVal = 500000
		}
		ginError(c, status, codeVal, err.Error())
		return
	}
	nextURL := "/login?session=" + session.LoginSessionID + "&poll_token=" + session.PollToken
	accept := strings.ToLower(c.GetHeader("Accept"))
	if strings.Contains(accept, "text/html") {
		c.Redirect(http.StatusFound, nextURL)
		return
	}
	ginSuccess(c, map[string]any{
		"login_session_id": session.LoginSessionID,
		"status":           session.Status,
		"exchange_token":   session.ExchangeToken,
		"next_url":         nextURL,
	})
}

func (h *AuthHandler) WechatBind(c *gin.Context) {
	accessToken, ok := ginBearerToken(c)
	if !ok {
		ginMissingAccessToken(c)
		return
	}
	var req wechatBindRequest
	if !bindJSONOrAbort(c, &req) {
		return
	}
	if req.BindTicket == "" {
		ginBadRequest(c, "bind_ticket is required")
		return
	}
	user, err := h.service.BindWechat(accessToken, req.BindTicket)
	if err != nil {
		status := http.StatusUnauthorized
		code := 401001
		if err.Error() != "invalid access token" {
			status = http.StatusInternalServerError
			code = 500000
		}
		ginError(c, status, code, err.Error())
		return
	}
	ginSuccess(c, map[string]any{
		"user_id":      user.UserID,
		"wechat_bound": user.WechatBound,
	})
}
