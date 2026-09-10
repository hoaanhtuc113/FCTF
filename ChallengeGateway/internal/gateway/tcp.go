package gateway

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

	"challenge-gateway/internal/config"
	"challenge-gateway/internal/limiter"
	"challenge-gateway/internal/telemetry"
	"challenge-gateway/internal/token"
)

const (
	tcpListenAddr        = ":1337"
	tcpMaxAuthTokenBytes = 1024
)

// tcpPendingAuth counts connections currently waiting for token authentication.
var tcpPendingAuth int64

// StartTCP starts the TCP proxy gateway and returns the listener so the caller
// can close it during graceful shutdown.
func StartTCP(ctx context.Context, cfg config.Config, limiters *limiter.Set) net.Listener {
	log.SetFlags(log.Flags() &^ (log.Ldate | log.Ltime | log.Lmicroseconds))
	tlsConfig, err := gatewayTLSConfig(cfg)
	if err != nil {
		log.Fatalf("TCP Gateway TLS config error: %v", err)
	}

	copyBufBytes := 32 * 1024
	if cfg.TCPCopyBufBytes > 0 {
		copyBufBytes = cfg.TCPCopyBufBytes
	}
	copyBufPool := &sync.Pool{New: func() any { return make([]byte, copyBufBytes) }}

	authTimeout := time.Duration(cfg.TCPAuthTimeoutSeconds) * time.Second
	if authTimeout <= 0 {
		authTimeout = 5 * time.Second
	}

	ln, err := net.Listen("tcp", tcpListenAddr)
	if err != nil {
		log.Fatalf("Error starting TCP gateway: %v", err)
	}
	ln = newGatewayListener(ln, tlsConfig)

	if tlsConfig != nil {
		log.Printf("[*] TCP Gateway running on port %s (TLS enabled)...", tcpListenAddr)
	} else {
		log.Printf("[*] TCP Gateway running on port %s...", tcpListenAddr)
	}

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	sem := make(chan struct{}, cfg.TCPMaxConns)
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				continue
			}

			ip := ParseRemoteIP(conn.RemoteAddr().String())
			if limiters != nil && limiters.TCPRate != nil && !limiters.TCPRate.Allow(context.Background(), ip) {
				emitTCPWithoutAssertion("tcp_rate_limited", ip, "rate_limited", "ip_rate_limit")
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPIPConn != nil && !limiters.TCPIPConn.Acquire(context.Background(), ip) {
				emitTCPWithoutAssertion("tcp_rate_limited", ip, "rate_limited", "ip_connection_limit")
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPGlobalConn != nil && !limiters.TCPGlobalConn.Acquire(context.Background(), "global") {
				if limiters.TCPIPConn != nil {
					limiters.TCPIPConn.Release(context.Background(), ip)
				}
				emitTCPWithoutAssertion("tcp_rate_limited", ip, "rate_limited", "global_connection_limit")
				_ = conn.Close()
				continue
			}

			sem <- struct{}{}
			go func(clientIP string) {
				defer func() { <-sem }()
				if limiters != nil && limiters.TCPIPConn != nil {
					defer limiters.TCPIPConn.Release(context.Background(), clientIP)
				}
				if limiters != nil && limiters.TCPGlobalConn != nil {
					defer limiters.TCPGlobalConn.Release(context.Background(), "global")
				}
				handleTCPConnection(conn, authTimeout, limiters, copyBufPool)
			}(ip)
		}
	}()

	return ln
}

func handleTCPConnection(clientConn net.Conn, authTimeout time.Duration, limiters *limiter.Set, copyBufPool *sync.Pool) {
	defer clientConn.Close()

	peerIP := ParseRemoteIP(clientConn.RemoteAddr().String())
	if rawConnProvider, ok := clientConn.(interface{ RawConn() net.Conn }); ok {
		if tcpConn, ok := rawConnProvider.RawConn().(*net.TCPConn); ok {
			_ = tcpConn.SetKeepAlive(true)
			_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
		}
	} else if tcpConn, ok := clientConn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
	}

	pending := atomic.AddInt64(&tcpPendingAuth, 1)
	log.Printf("[*] TCP pending auth connections: %d", pending)
	defer func() {
		p := atomic.AddInt64(&tcpPendingAuth, -1)
		log.Printf("[*] TCP pending auth connections: %d", p)
	}()

	payload, rawToken, err := authenticateTCPClient(clientConn, authTimeout)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		emitTCPWithoutAssertion("tcp_auth_failed", peerIP, "authentication_failed", "invalid_assertion")
		return
	}

	if limiters != nil && limiters.TCPRate != nil && !limiters.TCPRate.Allow(context.Background(), BuildRateLimitKeyForPayload(payload, rawToken, peerIP)) {
		fmt.Fprintln(clientConn, "Rate limit exceeded")
		emitTCPEvent("tcp_rate_limited", payload, peerIP, "rate_limited", "authenticated_rate_limit", 0, 0, 0, "")
		return
	}
	connectionKey := BuildRateLimitKeyForPayload(payload, rawToken, peerIP)
	if limiters != nil && limiters.TCPTokenConn != nil && !limiters.TCPTokenConn.Acquire(context.Background(), connectionKey) {
		fmt.Fprintln(clientConn, "Too many connections")
		emitTCPEvent("tcp_rate_limited", payload, peerIP, "rate_limited", "instance_connection_limit", 0, 0, 0, "")
		return
	}
	if limiters != nil && limiters.TCPTokenConn != nil {
		defer limiters.TCPTokenConn.Release(context.Background(), connectionKey)
	}

	host, err := token.ExpandRoute(payload.Route)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		emitTCPEvent("tcp_auth_failed", payload, peerIP, "authentication_failed", "invalid_route", 0, 0, 0, "")
		return
	}

	challengeConn, err := net.DialTimeout("tcp", host, 5*time.Second)
	if err != nil {
		fmt.Fprintln(clientConn, "[!] Could not connect to challenge server.")
		emitTCPEvent("tcp_dial_failed", payload, peerIP, "upstream_error", "upstream_unavailable", 0, 0, 0, "")
		return
	}
	defer challengeConn.Close()

	// A connect event only exists once the target service accepted a dial. It is
	// correlated to the instance without recording a hostname or bearer token.
	emitTCPEvent("tcp_connect", payload, peerIP, "connected", "", 0, 0, 0, "")
	fmt.Fprintln(clientConn, "Access Granted! Connecting to challenge...")

	startedAt := time.Now()
	results := make(chan tcpCopyResult, 2)
	var closeOnce sync.Once
	closeAll := func() {
		_ = clientConn.Close()
		_ = challengeConn.Close()
	}

	expiryTimer := time.NewTimer(time.Until(time.Unix(payload.Exp, 0)))
	expiryDone := make(chan struct{})
	defer close(expiryDone)
	defer func() {
		if !expiryTimer.Stop() {
			select {
			case <-expiryTimer.C:
			default:
			}
		}
	}()
	reason := ""
	var reasonMu sync.Mutex
	go func() {
		select {
		case <-expiryTimer.C:
			reasonMu.Lock()
			reason = "token_expired"
			reasonMu.Unlock()
			closeOnce.Do(closeAll)
		case <-expiryDone:
		}
	}()

	copyDirection := func(direction string, dst, src net.Conn) {
		bytesCopied, copyErr := proxyCopy(dst, src, copyBufPool)
		results <- tcpCopyResult{direction: direction, bytes: bytesCopied, err: copyErr}
		closeOnce.Do(closeAll)
	}
	go copyDirection("c2s", challengeConn, clientConn)
	go copyDirection("s2c", clientConn, challengeConn)

	first := <-results
	second := <-results
	reasonMu.Lock()
	terminationReason := reason
	reasonMu.Unlock()
	if terminationReason == "" {
		terminationReason = terminationReasonFor(first, second)
	}

	var bytesC2S, bytesS2C int64
	for _, result := range []tcpCopyResult{first, second} {
		if result.direction == "c2s" {
			bytesC2S = result.bytes
		} else {
			bytesS2C = result.bytes
		}
	}
	emitTCPEvent("tcp_session_end", payload, peerIP, "session_closed", "", bytesC2S, bytesS2C, time.Since(startedAt).Milliseconds(), terminationReason)
}

type tcpCopyResult struct {
	direction string
	bytes     int64
	err       error
}

func proxyCopy(dst io.Writer, src io.Reader, pool *sync.Pool) (int64, error) {
	buf := pool.Get().([]byte)
	defer pool.Put(buf)
	return io.CopyBuffer(dst, src, buf)
}

func terminationReasonFor(first, second tcpCopyResult) string {
	if first.err != nil || second.err != nil {
		return "io_error"
	}
	if first.direction == "c2s" {
		return "client_closed"
	}
	return "upstream_closed"
}

func emitTCPWithoutAssertion(eventName, peerIP, outcome, errorCode string) {
	event := telemetry.New(eventName, "tcp")
	event.PeerIP = peerIP
	event.IPSource = "remote_addr"
	event.Outcome = outcome
	event.ErrorCode = errorCode
	event.AuthStrength = "actor_unavailable"
	telemetry.Emit(event)
}

func emitTCPEvent(eventName string, payload token.Payload, peerIP, outcome, errorCode string, bytesC2S, bytesS2C, durationMS int64, terminationReason string) {
	event := telemetry.New(eventName, "tcp")
	event.InstanceID = payload.InstanceID
	event.InstanceNamespace = payload.Route
	event.ContestID = payload.ContestID
	event.ChallengeID = payload.ChallengeID
	event.ActorUserRef = payload.ActorUserRef
	event.ActorTeamID = payload.ActorTeamID
	event.PeerIP = peerIP
	event.IPSource = "remote_addr"
	event.Outcome = outcome
	event.ErrorCode = errorCode
	event.BytesC2S = bytesC2S
	event.BytesS2C = bytesS2C
	event.DurationMS = durationMS
	event.TerminationReason = terminationReason
	if payload.InstanceID == "" {
		event.AuthStrength = "legacy"
	} else if payload.ActorUserRef == "" {
		event.AuthStrength = "actor_unavailable"
	} else {
		event.AuthStrength = "credential_owner"
	}
	telemetry.Emit(event)
}

// authenticateTCPClient prompts the client for a token and verifies it.
func authenticateTCPClient(conn net.Conn, authTimeout time.Duration) (token.Payload, string, error) {
	timeout := authTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	defer func() { _ = conn.SetReadDeadline(time.Time{}) }()

	fmt.Fprintf(conn, "\n--- CTF AUTHENTICATION ---\nPlease enter your token (Timeout %ds): ", int(timeout.Seconds()))

	reader := bufio.NewReader(io.LimitReader(conn, tcpMaxAuthTokenBytes+1))
	input, err := reader.ReadString('\n')
	if err != nil {
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			return token.Payload{}, "", fmt.Errorf("authentication timed out")
		}
		if err == io.EOF && len(input) > tcpMaxAuthTokenBytes {
			return token.Payload{}, "", fmt.Errorf("token too long")
		}
		return token.Payload{}, "", err
	}
	if len(input) > tcpMaxAuthTokenBytes {
		return token.Payload{}, "", fmt.Errorf("token too long")
	}

	rawToken := strings.TrimSpace(input)
	if rawToken == "" {
		return token.Payload{}, "", fmt.Errorf("empty token")
	}

	payload, err := token.Verify(rawToken)
	if err != nil {
		return token.Payload{}, "", err
	}
	return payload, rawToken, nil
}
