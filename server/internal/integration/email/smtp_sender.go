package email

import (
	"strings"

	"lceda_ai/server/internal/app"

	gomail "gopkg.in/gomail.v2"
)

type SMTPSender struct {
	host string
	port int
	user string
	pass string
	from string
	tls  bool
}

func NewSMTPSender(cfg app.SMTPConfig) *SMTPSender {
	if strings.TrimSpace(cfg.Host) == "" || strings.TrimSpace(cfg.User) == "" || strings.TrimSpace(cfg.Pass) == "" {
		return nil
	}
	useTLS := true
	if cfg.TLS != nil {
		useTLS = *cfg.TLS
	}
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		from = strings.TrimSpace(cfg.User)
	}
	port := cfg.Port
	if port <= 0 {
		port = 465
	}
	return &SMTPSender{
		host: strings.TrimSpace(cfg.Host),
		port: port,
		user: strings.TrimSpace(cfg.User),
		pass: strings.TrimSpace(cfg.Pass),
		from: from,
		tls:  useTLS,
	}
}

func (s *SMTPSender) SendLoginCode(to string, code string) error {
	if s == nil {
		return nil
	}

	message := gomail.NewMessage()
	message.SetHeader("From", s.from)
	message.SetHeader("To", strings.TrimSpace(to))
	message.SetHeader("Subject", "LCEDA AI 登录验证码")
	message.SetBody("text/plain", "您的验证码是："+code+"\n，10 分钟内有效。")

	dialer := gomail.NewDialer(s.host, s.port, s.user, s.pass)
	dialer.SSL = s.tls
	return dialer.DialAndSend(message)
}
