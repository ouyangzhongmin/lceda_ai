package httptransport

import authusecase "lceda_ai/server/internal/usecase/auth"

type accessTokenUserResolver interface {
	GetUserByAccessToken(accessToken string) (authusecase.User, error)
}
