package memory

import (
	"sync"

	domaincredits "lceda_ai/server/internal/domain/credits"
)

type CreditsRepository struct {
	mu           sync.RWMutex
	balances     map[string]domaincredits.Balance
	transactions map[string][]domaincredits.Transaction
}

func NewCreditsRepository() *CreditsRepository {
	return &CreditsRepository{
		balances:     make(map[string]domaincredits.Balance),
		transactions: make(map[string][]domaincredits.Transaction),
	}
}

func (r *CreditsRepository) FindBalance(userID string) (domaincredits.Balance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	balance, ok := r.balances[userID]
	return balance, ok
}

func (r *CreditsRepository) SaveBalance(userID string, balance domaincredits.Balance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.balances[userID] = balance
	return nil
}

func (r *CreditsRepository) ListTransactions(userID string) []domaincredits.Transaction {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := r.transactions[userID]
	out := make([]domaincredits.Transaction, len(items))
	copy(out, items)
	return out
}

func (r *CreditsRepository) PrependTransaction(userID string, tx domaincredits.Transaction) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := r.transactions[userID]
	r.transactions[userID] = append([]domaincredits.Transaction{tx}, items...)
	return nil
}

func (r *CreditsRepository) Consume(userID string, tx domaincredits.Transaction, initial domaincredits.Balance) (domaincredits.Transaction, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	account, ok := r.balances[userID]
	if !ok {
		account = initial
	}
	if account.Balance < tx.Amount {
		return domaincredits.Transaction{}, domaincredits.ErrInsufficientBalance
	}
	account.Balance -= tx.Amount
	tx.BalanceAfter = account.Balance
	r.balances[userID] = account
	items := r.transactions[userID]
	r.transactions[userID] = append([]domaincredits.Transaction{tx}, items...)
	return tx, nil
}
