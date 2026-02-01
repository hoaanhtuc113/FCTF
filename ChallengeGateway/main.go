package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found, reading system environment variables")
	}

	cfg := loadConfig()
	redisClient := initRedis(cfg)
	if err := initLimiters(cfg, redisClient); err != nil {
		log.Fatalf("Limiter initialization failed: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	httpServer := startHTTPGateway(cfg)
	tcpListener := startTCPGateway(ctx, cfg)

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