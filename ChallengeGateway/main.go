package main

import (
	"fmt"
	"log"
	"net"

	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found, reading system environment variables")
	}

	startHTTPGateway()

	listenPort := ":1337"
	ln, err := net.Listen("tcp", listenPort)
	if err != nil {
		log.Fatalf("Error starting gateway: %v", err)
	}
	defer ln.Close()

	fmt.Printf("[*] TCP Gateway running on port %s...\n", listenPort)

	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		go HandleConnection(conn)
	}
}