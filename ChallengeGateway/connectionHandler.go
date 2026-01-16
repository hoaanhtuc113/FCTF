package main

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"challenge-gateway/db" 
	"github.com/redis/go-redis/v9"
)

func HandleConnection(clientConn net.Conn, rdb *redis.Client) {
	defer clientConn.Close()

	challengeTarget, err := authenticateClient(clientConn, rdb)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		fmt.Printf("[-] Auth failed: %v\n", err)
		return
	}

	fmt.Fprintf(clientConn, "Access Granted! Connecting to challenge...\n")
	challengeConn, err := net.Dial("tcp", challengeTarget)
	if err != nil {
		fmt.Fprintf(clientConn, "[!] Could not connect to challenge server.\n")
		return
	}
	defer challengeConn.Close()

	done := make(chan struct{})

	go func() {
		io.Copy(challengeConn, clientConn)
		done <- struct{}{}
	}()

	go func() {
		io.Copy(clientConn, challengeConn)
		done <- struct{}{}
	}()

	<-done
	fmt.Printf("[+] Session ended: %s\n", clientConn.RemoteAddr())
}


func authenticateClient(conn net.Conn, rdb *redis.Client) (string, error) {
    timeoutDuration := 60 * time.Second
    conn.SetReadDeadline(time.Now().Add(timeoutDuration))

    fmt.Fprint(conn, "\n--- CTF AUTHENTICATION ---\nPlease enter your token (Timeout 60s): ")

    reader := bufio.NewReader(conn)
    input, err := reader.ReadString('\n')
    
    if err != nil {
        if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
            return "", fmt.Errorf("Authentication timed out")
        }
        return "", err
    }

    conn.SetReadDeadline(time.Time{}) 

    token := strings.TrimSpace(input)
    if token == "" {
        return "", fmt.Errorf("empty token")
    }

    target, err := db.GetChallengeConnectionByToken(rdb, token)
    if err != nil {
        return "", err
    }

    return target, nil
}