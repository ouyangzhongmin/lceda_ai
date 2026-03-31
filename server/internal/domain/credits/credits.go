package credits

import (
	"errors"
	"time"
)

var ErrInsufficientBalance = errors.New("insufficient credits balance")

type Balance struct {
	Balance  int64  `json:"balance"`
	Currency string `json:"currency"`
	Frozen   int64  `json:"frozen"`
}

type Transaction struct {
	TransactionID     string    `json:"transaction_id"`
	TransactionType   string    `json:"transaction_type"`
	Scene             string    `json:"scene"`
	Amount            int64     `json:"amount"`
	BalanceAfter      int64     `json:"balance_after"`
	RelatedObjectType string    `json:"related_object_type,omitempty"`
	RelatedObjectUID  string    `json:"related_object_uid,omitempty"`
	Remark            string    `json:"remark,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
}

type Repository interface {
	FindBalance(userID string) (Balance, bool)
	SaveBalance(userID string, balance Balance) error
	ListTransactions(userID string) []Transaction
	PrependTransaction(userID string, tx Transaction) error
}
