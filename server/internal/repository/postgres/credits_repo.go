package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	domaincredits "lceda_ai/server/internal/domain/credits"
)

type CreditsRepository struct {
	pool *pgxpool.Pool
}

func NewCreditsRepository(pool *pgxpool.Pool) *CreditsRepository {
	return &CreditsRepository{pool: pool}
}

func (r *CreditsRepository) FindBalance(userID string) (domaincredits.Balance, bool) {
	if r.pool == nil {
		return domaincredits.Balance{}, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var balance domaincredits.Balance
	err := r.pool.QueryRow(ctx, `
		SELECT ca.balance, ca.currency, ca.frozen_balance
		FROM credit_accounts ca
		JOIN users u ON u.id = ca.user_id
		WHERE u.user_uid = $1
		LIMIT 1
	`, userID).Scan(&balance.Balance, &balance.Currency, &balance.Frozen)
	if err != nil {
		return domaincredits.Balance{}, false
	}
	return balance, true
}

func (r *CreditsRepository) SaveBalance(userID string, balance domaincredits.Balance) error {
	if r.pool == nil {
		return errors.New("postgres pool is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var dbUserID int64
	if err := r.pool.QueryRow(ctx, `SELECT id FROM users WHERE user_uid = $1`, userID).Scan(&dbUserID); err != nil {
		return err
	}

	_, err := r.pool.Exec(ctx, `
		INSERT INTO credit_accounts (account_uid, user_id, balance, frozen_balance, currency, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET balance = EXCLUDED.balance,
		    frozen_balance = EXCLUDED.frozen_balance,
		    currency = EXCLUDED.currency,
		    updated_at = NOW()
	`, "acc_"+userID, dbUserID, balance.Balance, balance.Frozen, creditNonEmptyOr(balance.Currency, "credits"))
	return err
}

func (r *CreditsRepository) ListTransactions(userID string) []domaincredits.Transaction {
	if r.pool == nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	rows, err := r.pool.Query(ctx, `
		SELECT ct.transaction_uid, ct.transaction_type, ct.scene, ct.amount, ct.balance_after,
		       COALESCE(ct.related_object_type, ''), COALESCE(ct.related_object_uid, ''), COALESCE(ct.remark, ''), ct.created_at
		FROM credit_transactions ct
		JOIN users u ON u.id = ct.user_id
		WHERE u.user_uid = $1
		ORDER BY ct.created_at DESC
	`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	out := make([]domaincredits.Transaction, 0)
	for rows.Next() {
		var item domaincredits.Transaction
		if rows.Scan(
			&item.TransactionID,
			&item.TransactionType,
			&item.Scene,
			&item.Amount,
			&item.BalanceAfter,
			&item.RelatedObjectType,
			&item.RelatedObjectUID,
			&item.Remark,
			&item.CreatedAt,
		) == nil {
			out = append(out, item)
		}
	}
	return out
}

func (r *CreditsRepository) PrependTransaction(userID string, tx domaincredits.Transaction) error {
	if r.pool == nil {
		return errors.New("postgres pool is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var accountID, dbUserID int64
	err := r.pool.QueryRow(ctx, `
		SELECT ca.id, u.id
		FROM credit_accounts ca
		JOIN users u ON u.id = ca.user_id
		WHERE u.user_uid = $1
		LIMIT 1
	`, userID).Scan(&accountID, &dbUserID)
	if err != nil {
		return err
	}

	_, err = r.pool.Exec(ctx, `
		INSERT INTO credit_transactions (
			transaction_uid, account_id, user_id, transaction_type, scene, amount, balance_after,
			related_object_type, related_object_uid, remark, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, tx.TransactionID, accountID, dbUserID, tx.TransactionType, tx.Scene, tx.Amount, tx.BalanceAfter,
		creditNullableString(tx.RelatedObjectType), creditNullableString(tx.RelatedObjectUID), creditNullableString(tx.Remark), tx.CreatedAt)
	return err
}

func (r *CreditsRepository) Consume(userID string, tx domaincredits.Transaction, initial domaincredits.Balance) (domaincredits.Transaction, error) {
	if r.pool == nil {
		return domaincredits.Transaction{}, errors.New("postgres pool is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dbtx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return domaincredits.Transaction{}, err
	}
	defer dbtx.Rollback(ctx)

	var dbUserID int64
	if err := dbtx.QueryRow(ctx, `SELECT id FROM users WHERE user_uid = $1`, userID).Scan(&dbUserID); err != nil {
		return domaincredits.Transaction{}, err
	}

	_, err = dbtx.Exec(ctx, `
		INSERT INTO credit_accounts (account_uid, user_id, balance, frozen_balance, currency, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
		ON CONFLICT (user_id) DO NOTHING
	`, "acc_"+userID, dbUserID, initial.Balance, initial.Frozen, creditNonEmptyOr(initial.Currency, "credits"))
	if err != nil {
		return domaincredits.Transaction{}, err
	}

	var (
		accountID int64
		balance   domaincredits.Balance
	)
	if err := dbtx.QueryRow(ctx, `
		SELECT id, balance, currency, frozen_balance
		FROM credit_accounts
		WHERE user_id = $1
		FOR UPDATE
	`, dbUserID).Scan(&accountID, &balance.Balance, &balance.Currency, &balance.Frozen); err != nil {
		return domaincredits.Transaction{}, err
	}
	if balance.Balance < tx.Amount {
		return domaincredits.Transaction{}, domaincredits.ErrInsufficientBalance
	}

	tx.BalanceAfter = balance.Balance - tx.Amount
	_, err = dbtx.Exec(ctx, `
		UPDATE credit_accounts
		SET balance = $2, updated_at = NOW()
		WHERE id = $1
	`, accountID, tx.BalanceAfter)
	if err != nil {
		return domaincredits.Transaction{}, err
	}

	_, err = dbtx.Exec(ctx, `
		INSERT INTO credit_transactions (
			transaction_uid, account_id, user_id, transaction_type, scene, amount, balance_after,
			related_object_type, related_object_uid, remark, created_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
	`, tx.TransactionID, accountID, dbUserID, tx.TransactionType, tx.Scene, tx.Amount, tx.BalanceAfter,
		creditNullableString(tx.RelatedObjectType), creditNullableString(tx.RelatedObjectUID), creditNullableString(tx.Remark), tx.CreatedAt)
	if err != nil {
		return domaincredits.Transaction{}, err
	}

	if err := dbtx.Commit(ctx); err != nil {
		return domaincredits.Transaction{}, err
	}
	return tx, nil
}

func creditNullableString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func creditNonEmptyOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
