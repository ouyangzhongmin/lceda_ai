package credits

import (
	"errors"
	"time"

	domaincredits "lceda_ai/server/internal/domain/credits"
	"lceda_ai/server/internal/pkg/idgen"
)

var ErrInsufficientBalance = domaincredits.ErrInsufficientBalance

type Balance = domaincredits.Balance
type Transaction = domaincredits.Transaction

type Service struct {
	repo domaincredits.Repository
}

type atomicCreditsRepository interface {
	Consume(userID string, tx Transaction, initial Balance) (Transaction, error)
}

func NewService(repo domaincredits.Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetBalance(userID string) (Balance, error) {
	return s.ensureAccount(userID)
}

func (s *Service) Consume(
	userID string,
	amount int64,
	scene string,
	relatedObjectType string,
	relatedObjectUID string,
	remark string,
) (Transaction, error) {
	account, err := s.ensureAccount(userID)
	if err != nil {
		return Transaction{}, err
	}
	if amount <= 0 {
		return Transaction{}, errors.New("invalid consume amount")
	}
	if account.Balance < amount {
		return Transaction{}, ErrInsufficientBalance
	}

	account.Balance -= amount
	tx := Transaction{
		TransactionID:     idgen.New("ctx"),
		TransactionType:   "consume",
		Scene:             scene,
		Amount:            amount,
		BalanceAfter:      account.Balance,
		RelatedObjectType: relatedObjectType,
		RelatedObjectUID:  relatedObjectUID,
		Remark:            remark,
		CreatedAt:         time.Now(),
	}
	if atomicRepo, ok := s.repo.(atomicCreditsRepository); ok {
		return atomicRepo.Consume(userID, tx, defaultBalance())
	}
	if err := s.repo.SaveBalance(userID, account); err != nil {
		return Transaction{}, err
	}
	if err := s.repo.PrependTransaction(userID, tx); err != nil {
		return Transaction{}, err
	}
	return tx, nil
}

func (s *Service) ListTransactions(userID string, limit int) ([]Transaction, error) {
	transactions := s.repo.ListTransactions(userID)
	if limit <= 0 || limit > len(transactions) {
		limit = len(transactions)
	}
	copied := make([]Transaction, limit)
	copy(copied, transactions[:limit])
	return copied, nil
}

func (s *Service) ensureAccount(userID string) (Balance, error) {
	account, ok := s.repo.FindBalance(userID)
	if ok {
		return account, nil
	}

	account = defaultBalance()
	if err := s.repo.SaveBalance(userID, account); err != nil {
		return Balance{}, err
	}
	return account, nil
}

func defaultBalance() Balance {
	return Balance{
		Balance:  1250,
		Currency: "credits",
		Frozen:   0,
	}
}
