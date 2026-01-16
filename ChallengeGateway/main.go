package main

import (
	"log"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found, reading system environment variables")
	}

	startHTTPGateway()
	startTCPGateway()
}