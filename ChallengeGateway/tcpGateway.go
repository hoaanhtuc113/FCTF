package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"
)

var tcpRateLimiter *rateLimiter
var tcpIPConnLimiter *ipConnLimiter

func startTCPGateway(ctx context.Context, cfg gatewayConfig) net.Listener {
	listenPort := ":1337"
	ln, err := net.Listen("tcp", listenPort)
	if err != nil {
		log.Fatalf("Error starting gateway: %v", err)
	}

	maxConns := cfg.TCPMaxConns
	sem := make(chan struct{}, maxConns)

	fmt.Printf("[*] TCP Gateway running on port %s...\n", listenPort)

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				continue
			}

			ip := parseRemoteIP(conn.RemoteAddr().String())
			if tcpRateLimiter != nil && !tcpRateLimiter.Allow(ip) {
				_ = conn.Close()
				continue
			}
			if tcpIPConnLimiter != nil && !tcpIPConnLimiter.acquire(ip) {
				_ = conn.Close()
				continue
			}

			sem <- struct{}{}
			go func(clientIP string) {
				defer func() { <-sem }()
				if tcpIPConnLimiter != nil {
					defer tcpIPConnLimiter.release(clientIP)
				}
				HandleConnection(conn)
			}(ip)
		}
	}()

	return ln
}

func HandleConnection(clientConn net.Conn) {
	defer clientConn.Close()
	log.Printf("[+] TCP connection from %s", clientConn.RemoteAddr())
	if tcpConn, ok := clientConn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
	}

	challengeTarget, err := authenticateClient(clientConn)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		fmt.Printf("[-] Auth failed: %v\n", err)
		return
	}
	log.Printf("[+] Auth OK for %s -> %s", clientConn.RemoteAddr(), challengeTarget)

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
	log.Printf("[+] Session ended: %s", clientConn.RemoteAddr())
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