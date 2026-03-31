package httptransport

import "time"

type RequestLogEntry struct {
	RequestID  string
	UserID     string
	Path       string
	Method     string
	StatusCode int
	ClientIP   string
	UserAgent  string
	LatencyMS  int
	ErrorCode  string
	CreatedAt  time.Time
}

type RequestLogRepository interface {
	Save(entry RequestLogEntry) error
}
