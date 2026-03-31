package idgen

import (
	"crypto/rand"
	"encoding/hex"
)

func New(prefix string) string {
	buf := make([]byte, 6)
	_, _ = rand.Read(buf)
	return prefix + "_" + hex.EncodeToString(buf)
}
