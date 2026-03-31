package main

import (
	"log"

	"lceda_ai/server/internal/app"
	"lceda_ai/server/internal/bootstrap"
)

func main() {
	cfg, err := app.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}

	server, err := bootstrap.NewServer(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer server.Close()

	addr := ":" + cfg.Server.Port
	log.Printf("listening on %s", addr)
	if err := server.Router.Run(addr); err != nil {
		log.Fatal(err)
	}
}
