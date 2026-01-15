package main

import (
	"fmt"
	"log"
	"net"
	"os"

	"challenge-gateway/db"
	"github.com/joho/godotenv"
)

type Config struct {
	RedisAddr     string
	RedisPass     string
	ListenPort    string
}

func initEnv() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found, reading system environment variables")
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	redisPass := os.Getenv("REDIS_PASSWORD")
	listenPort := os.Getenv("LISTEN_PORT")

	if redisAddr == "" {
		log.Fatal("ERROR: REDIS_ADDR is not set in environment variables. Critical failure.")
	}

	if listenPort == "" {
		log.Println("Info: LISTEN_PORT not set, using default :1337")
		listenPort = ":1337"
	}

	return &Config{
		RedisAddr:  redisAddr,
		RedisPass:  redisPass,
		ListenPort: listenPort,
	}
}

func main() {
	config := initEnv()

	rdb, err := db.InitRedis(config.RedisAddr, config.RedisPass)
	if err != nil {
		log.Fatalf("Could not connect to Redis: %v", err)
	}
	fmt.Println("[+] Connected to Redis successfully")

	ln, err := net.Listen("tcp", config.ListenPort)
	if err != nil {
		log.Fatalf("Error starting gateway: %v", err)
	}
	defer ln.Close()

	fmt.Printf("[*] TCP Gateway running on port %s...\n", config.ListenPort)

	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}

		go HandleConnection(conn, rdb)
	}
}