package wechat

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	domainauth "lceda_ai/server/internal/domain/auth"
)

type Client = domainauth.WechatProvider

func NewClient(appID string, appSecret string, redirectURI string) Client {
	if appID == "" || appSecret == "" || redirectURI == "" {
		return NewMockClient()
	}
	return &OpenPlatformClient{
		appID:       appID,
		appSecret:   appSecret,
		redirectURI: redirectURI,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

type OpenPlatformClient struct {
	appID       string
	appSecret   string
	redirectURI string
	httpClient  *http.Client
}

func (c *OpenPlatformClient) BuildAuthorizeURL(state string) string {
	values := url.Values{}
	values.Set("appid", c.appID)
	values.Set("redirect_uri", c.redirectURI)
	values.Set("response_type", "code")
	values.Set("scope", "snsapi_login")
	values.Set("state", state)
	return "https://open.weixin.qq.com/connect/qrconnect?" + values.Encode() + "#wechat_redirect"
}

func (c *OpenPlatformClient) ResolveUserByCode(code string) (domainauth.WechatProfile, error) {
	if code == "" {
		return domainauth.WechatProfile{}, errors.New("invalid wechat code")
	}

	tokenResp, err := c.exchangeCodeForToken(code)
	if err != nil {
		return domainauth.WechatProfile{}, err
	}
	userResp, err := c.fetchUserInfo(tokenResp.AccessToken, tokenResp.OpenID)
	if err != nil {
		return domainauth.WechatProfile{}, err
	}
	unionID := strings.TrimSpace(userResp.UnionID)
	if unionID == "" {
		unionID = "openid_" + userResp.OpenID
	}
	displayName := strings.TrimSpace(userResp.Nickname)
	if displayName == "" {
		displayName = "wx_" + unionID
	}

	return domainauth.WechatProfile{
		UnionID:     unionID,
		OpenID:      userResp.OpenID,
		DisplayName: displayName,
	}, nil
}

func (c *OpenPlatformClient) exchangeCodeForToken(code string) (oauthTokenResponse, error) {
	values := url.Values{}
	values.Set("appid", c.appID)
	values.Set("secret", c.appSecret)
	values.Set("code", code)
	values.Set("grant_type", "authorization_code")

	u := "https://api.weixin.qq.com/sns/oauth2/access_token?" + values.Encode()
	payload, err := c.getJSON(u)
	if err != nil {
		return oauthTokenResponse{}, err
	}

	var resp oauthTokenResponse
	if err := json.Unmarshal(payload, &resp); err != nil {
		return oauthTokenResponse{}, err
	}
	if resp.ErrCode != 0 {
		return oauthTokenResponse{}, fmt.Errorf("wechat token exchange failed: %d %s", resp.ErrCode, resp.ErrMsg)
	}
	if strings.TrimSpace(resp.AccessToken) == "" || strings.TrimSpace(resp.OpenID) == "" {
		return oauthTokenResponse{}, errors.New("wechat token exchange returned empty access_token or openid")
	}

	return resp, nil
}

func (c *OpenPlatformClient) fetchUserInfo(accessToken string, openID string) (userInfoResponse, error) {
	values := url.Values{}
	values.Set("access_token", accessToken)
	values.Set("openid", openID)

	u := "https://api.weixin.qq.com/sns/userinfo?" + values.Encode()
	payload, err := c.getJSON(u)
	if err != nil {
		return userInfoResponse{}, err
	}

	var resp userInfoResponse
	if err := json.Unmarshal(payload, &resp); err != nil {
		return userInfoResponse{}, err
	}
	if resp.ErrCode != 0 {
		return userInfoResponse{}, fmt.Errorf("wechat userinfo failed: %d %s", resp.ErrCode, resp.ErrMsg)
	}
	if strings.TrimSpace(resp.OpenID) == "" {
		return userInfoResponse{}, errors.New("wechat userinfo returned empty openid")
	}

	return resp, nil
}

func (c *OpenPlatformClient) getJSON(url string) ([]byte, error) {
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("wechat api http status: %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return body, nil
}

type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
	OpenID      string `json:"openid"`
	UnionID     string `json:"unionid"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

type userInfoResponse struct {
	OpenID   string `json:"openid"`
	UnionID  string `json:"unionid"`
	Nickname string `json:"nickname"`
	ErrCode  int    `json:"errcode"`
	ErrMsg   string `json:"errmsg"`
}

type MockClient struct{}

func NewMockClient() Client {
	return &MockClient{}
}

func (c *MockClient) BuildAuthorizeURL(state string) string {
	values := url.Values{}
	values.Set("appid", "mock_appid")
	values.Set("redirect_uri", "https://example.com/mock-wechat-callback")
	values.Set("response_type", "code")
	values.Set("scope", "snsapi_login")
	values.Set("state", state)
	return "https://open.weixin.qq.com/connect/qrconnect?" + values.Encode() + "#wechat_redirect"
}

func (c *MockClient) ResolveUserByCode(code string) (domainauth.WechatProfile, error) {
	if code == "" {
		return domainauth.WechatProfile{}, errors.New("invalid wechat code")
	}
	return domainauth.WechatProfile{
		UnionID:     "union_" + code,
		OpenID:      "openid_" + code,
		DisplayName: "wx_" + code,
	}, nil
}
