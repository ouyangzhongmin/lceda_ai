package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"lceda_ai/server/internal/app"
)

func OpenPool(cfg app.DatabaseConfig) (*pgxpool.Pool, error) {
	dsn := cfg.DSN
	if dsn == "" {
		dsn = "postgres://" + cfg.User + ":" + cfg.Password + "@" + cfg.Host + ":" + cfg.Port + "/" + cfg.Name + "?sslmode=" + cfg.SSLMode
	}
	if dsn == "" {
		return nil, errors.New("postgres dsn is empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}
