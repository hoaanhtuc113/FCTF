package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"
)

type challengeTokenPayload struct {
	Exp   int64  `json:"exp"`
	Route string `json:"route"`
}

func HandleConnection(clientConn net.Conn) {
	defer clientConn.Close()

	challengeTarget, err := authenticateClient(clientConn)
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


func authenticateClient(conn net.Conn) (string, error) {
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

	return getRouteFromChallengeToken(token)
}

func getRouteFromChallengeToken(token string) (string, error) {
	payload, err := verifyChallengeToken(token)
	if err != nil {
		return "", err
	}
	return payload.Route, nil
}

func verifyChallengeToken(token string) (challengeTokenPayload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return challengeTokenPayload{}, fmt.Errorf("invalid token format")
	}

	secret := os.Getenv("PRIVATE_KEY")
	if strings.TrimSpace(secret) == "" {
		return challengeTokenPayload{}, fmt.Errorf("missing PRIVATE_KEY")
	}

	payloadB64 := parts[0]
	sigB64 := parts[1]

	sigBytes, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid signature encoding")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payloadB64))
	expected := mac.Sum(nil)
	if !hmac.Equal(sigBytes, expected) {
		return challengeTokenPayload{}, fmt.Errorf("invalid token signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload encoding")
	}

	var payload challengeTokenPayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload json")
	}

	if payload.Exp <= 0 || payload.Route == "" {
		return challengeTokenPayload{}, fmt.Errorf("invalid payload content")
	}

	if time.Now().Unix() > payload.Exp {
		return challengeTokenPayload{}, fmt.Errorf("token expired")
	}

	return payload, nil
}