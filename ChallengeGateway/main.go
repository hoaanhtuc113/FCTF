package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
	"github.com/joho/godotenv"
	"challenge-gateway/internal/config"
	"challenge-gateway/internal/gateway"
	"challenge-gateway/internal/limiter"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found, reading system environment variables")
	}

	cfg := config.Load()

	redisClient := limiter.InitRedis(cfg)
	limiters, err := limiter.Init(cfg, redisClient)
	if err != nil {
		log.Fatalf("Limiter initialization failed: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	httpServer := gateway.StartHTTP(cfg, limiters)
	tcpListener := gateway.StartTCP(ctx, cfg, limiters)

	<-ctx.Done()
	log.Println("Shutting down gateways...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if httpServer != nil {
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP shutdown error: %v", err)
		}
	}
	if tcpListener != nil {
		_ = tcpListener.Close()
	}
}