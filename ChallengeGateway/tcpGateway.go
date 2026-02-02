package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var tcpRateLimiter rateLimiter
var tcpIPConnLimiter connLimiter
var tcpTokenConnLimiter connLimiter
var tcpGlobalConnLimiter connLimiter
var tcpAuthTimeout time.Duration
var tcpPendingAuth int64

var tcpCopyBufPool = sync.Pool{
	New: func() any {
		buf := make([]byte, 32*1024)
		return buf
	},
}

func startTCPGateway(ctx context.Context, cfg gatewayConfig) net.Listener {
	listenPort := ":1337"
	ln, err := net.Listen("tcp", listenPort)
	if err != nil {
		log.Fatalf("Error starting gateway: %v", err)
	}
	if cfg.TCPAuthTimeoutSeconds > 0 {
		tcpAuthTimeout = time.Duration(cfg.TCPAuthTimeoutSeconds) * time.Second
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
			if tcpRateLimiter != nil && !tcpRateLimiter.Allow(context.Background(), ip) {
				_ = conn.Close()
				continue
			}
			if tcpIPConnLimiter != nil && !tcpIPConnLimiter.Acquire(context.Background(), ip) {
				_ = conn.Close()
				continue
			}
			if tcpGlobalConnLimiter != nil && !tcpGlobalConnLimiter.Acquire(context.Background(), "global") {
				if tcpIPConnLimiter != nil {
					tcpIPConnLimiter.Release(context.Background(), ip)
				}
				_ = conn.Close()
				continue
			}

			sem <- struct{}{}
			go func(clientIP string) {
				defer func() { <-sem }()
				if tcpIPConnLimiter != nil {
					defer tcpIPConnLimiter.Release(context.Background(), clientIP)
				}
				if tcpGlobalConnLimiter != nil {
					defer tcpGlobalConnLimiter.Release(context.Background(), "global")
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
	pending := atomic.AddInt64(&tcpPendingAuth, 1)
	log.Printf("[*] TCP pending auth connections: %d", pending)
	defer func() {
		pending := atomic.AddInt64(&tcpPendingAuth, -1)
		log.Printf("[*] TCP pending auth connections: %d", pending)
	}()

	payload, token, err := authenticateClient(clientConn)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		fmt.Printf("[-] Auth failed: %v\n", err)
		return
	}
	clientIP := parseRemoteIP(clientConn.RemoteAddr().String())
	if tcpRateLimiter != nil {
		key := buildRateLimitKey(token, clientIP)
		if !tcpRateLimiter.Allow(context.Background(), key) {
			fmt.Fprintln(clientConn, "Rate limit exceeded")
			return
		}
	}
	if tcpTokenConnLimiter != nil && token != "" {
		if !tcpTokenConnLimiter.Acquire(context.Background(), token) {
			fmt.Fprintln(clientConn, "Too many connections for token")
			return
		}
		defer tcpTokenConnLimiter.Release(context.Background(), token)
	}
	host := expandRoute(payload.Route)
	log.Printf("[+] Auth OK for %s -> %s", clientConn.RemoteAddr(), host)

	fmt.Fprintf(clientConn, "Access Granted! Connecting to challenge...\n")
	challengeConn, err := net.Dial("tcp", host)
	if err != nil {
		fmt.Fprintf(clientConn, "[!] Could not connect to challenge server.\n")
		return
	}
	defer challengeConn.Close()

	done := make(chan struct{}, 2)
	var closeOnce sync.Once
	closeAll := func() {
		_ = clientConn.Close()
		_ = challengeConn.Close()
	}
	proxyCopy := func(dst, src net.Conn) {
		buf := tcpCopyBufPool.Get().([]byte)
		_, _ = io.CopyBuffer(dst, src, buf)
		tcpCopyBufPool.Put(buf)
		closeOnce.Do(closeAll)
		done <- struct{}{}
	}

	go proxyCopy(challengeConn, clientConn)
	go proxyCopy(clientConn, challengeConn)

	<-done
	log.Printf("[+] Session ended: %s", clientConn.RemoteAddr())
}


func authenticateClient(conn net.Conn) (challengeTokenPayload, string, error) {
	timeoutDuration := tcpAuthTimeout
	if timeoutDuration <= 0 {
		timeoutDuration = 10 * time.Second
	}
    conn.SetReadDeadline(time.Now().Add(timeoutDuration))

	fmt.Fprintf(conn, "\n--- CTF AUTHENTICATION ---\nPlease enter your token (Timeout %ds): ", int(timeoutDuration.Seconds()))

    reader := bufio.NewReader(conn)
    input, err := reader.ReadString('\n')
    
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return challengeTokenPayload{}, "", fmt.Errorf("Authentication timed out")
		}
		return challengeTokenPayload{}, "", err
	}

    conn.SetReadDeadline(time.Time{}) 

    token := strings.TrimSpace(input)
    if token == "" {
        return challengeTokenPayload{}, "", fmt.Errorf("empty token")
    }

	payload, err := verifyChallengeToken(token)
	if err != nil {
		return challengeTokenPayload{}, "", err
	}

	return payload, token, nil
}

