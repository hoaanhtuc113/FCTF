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
	"challenge-gateway/internal/requestlog"
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

	var authTimeout time.Duration
	if cfg.TCPAuthTimeoutSeconds > 0 {
		authTimeout = time.Duration(cfg.TCPAuthTimeoutSeconds) * time.Second
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

			// One ID per accepted socket, including connections rejected before
			// token authentication. It is correlation metadata, never an identity.
			sessionID := telemetry.NewSessionID()
			ip := ParseRemoteIP(conn.RemoteAddr().String())
			if limiters != nil && limiters.TCPRate != nil && !limiters.TCPRate.Allow(context.Background(), ip) {
				emitTCPEvent("tcp_rate_limited", sessionID, ip, nil, "rate_limited", "ip_rate_limit")
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPIPConn != nil && !limiters.TCPIPConn.Acquire(context.Background(), ip) {
				emitTCPEvent("tcp_rate_limited", sessionID, ip, nil, "rate_limited", "ip_connection_limit")
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPGlobalConn != nil && !limiters.TCPGlobalConn.Acquire(context.Background(), "global") {
				if limiters.TCPIPConn != nil {
					limiters.TCPIPConn.Release(context.Background(), ip)
				}
				emitTCPEvent("tcp_rate_limited", sessionID, ip, nil, "rate_limited", "global_connection_limit")
				_ = conn.Close()
				continue
			}

			sem <- struct{}{}
			go func(conn net.Conn, clientIP, id string) {
				defer func() { <-sem }()
				if limiters != nil && limiters.TCPIPConn != nil {
					defer limiters.TCPIPConn.Release(context.Background(), clientIP)
				}
				if limiters != nil && limiters.TCPGlobalConn != nil {
					defer limiters.TCPGlobalConn.Release(context.Background(), "global")
				}
				handleTCPConnection(conn, id, authTimeout, limiters, copyBufPool)
			}(conn, ip, sessionID)
		}
	}()

	return ln
}

func handleTCPConnection(clientConn net.Conn, sessionID string, authTimeout time.Duration, limiters *limiter.Set, copyBufPool *sync.Pool) {
	defer clientConn.Close()
	startedAt := time.Now()
	clientIP := ParseRemoteIP(clientConn.RemoteAddr().String())

	if rawConnProvider, ok := clientConn.(interface{ RawConn() net.Conn }); ok {
		if tcpConn, ok := rawConnProvider.RawConn().(*net.TCPConn); ok {
			_ = tcpConn.SetKeepAlive(true)
			_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
		}
	} else if tcpConn, ok := clientConn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
	}

	atomic.AddInt64(&tcpPendingAuth, 1)
	defer atomic.AddInt64(&tcpPendingAuth, -1)

	payload, tok, err := authenticateTCPClient(clientConn, authTimeout)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		emitTCPEvent("tcp_auth_failed", sessionID, clientIP, nil, "authentication_failed", authErrorCode(err))
		return
	}

	if limiters != nil && limiters.TCPRate != nil && !limiters.TCPRate.Allow(context.Background(), BuildRateLimitKey(tok, clientIP)) {
		fmt.Fprintln(clientConn, "Rate limit exceeded")
		emitTCPEvent("tcp_rate_limited", sessionID, clientIP, &payload, "rate_limited", "authenticated_rate_limit")
		return
	}
	if limiters != nil && limiters.TCPTokenConn != nil && tok != "" && !limiters.TCPTokenConn.Acquire(context.Background(), tok) {
		fmt.Fprintln(clientConn, "Too many connections for token")
		emitTCPEvent("tcp_rate_limited", sessionID, clientIP, &payload, "rate_limited", "token_connection_limit")
		return
	}
	if limiters != nil && limiters.TCPTokenConn != nil && tok != "" {
		defer limiters.TCPTokenConn.Release(context.Background(), tok)
	}

	host := token.ExpandRoute(payload.Route)
	challengeConn, err := net.Dial("tcp", host)
	if err != nil {
		fmt.Fprintln(clientConn, "Could not connect to challenge server.")
		emitTCPEvent("tcp_dial_failed", sessionID, clientIP, &payload, "dial_failed", "upstream_unavailable")
		return
	}
	defer challengeConn.Close()

	if time.Now().Unix() >= payload.Exp {
		_ = clientConn.Close()
		_ = challengeConn.Close()
		emitTCPEventWithStats("tcp_session_end", sessionID, clientIP, &payload, 0, 0, time.Since(startedAt), "token_expired")
		return
	}

	fmt.Fprintln(clientConn, "Access Granted! Connecting to challenge...")
	emitTCPEvent("tcp_connect", sessionID, clientIP, &payload, "connected", "")

	var closeOnce sync.Once
	closeAll := func() {
		_ = clientConn.Close()
		_ = challengeConn.Close()
	}
	var terminationMu sync.Mutex
	terminationReason := "connection_closed"
	setTermination := func(reason string) {
		terminationMu.Lock()
		if terminationReason == "connection_closed" && reason != "" {
			terminationReason = reason
		}
		terminationMu.Unlock()
	}

	expiryCtx, cancelExpiry := context.WithCancel(context.Background())
	defer cancelExpiry()
	expiryTimer := time.NewTimer(time.Until(time.Unix(payload.Exp, 0)))
	defer expiryTimer.Stop()
	go func() {
		select {
		case <-expiryTimer.C:
			setTermination("token_expired")
			closeOnce.Do(closeAll)
		case <-expiryCtx.Done():
		}
	}()

	type copyResult struct {
		direction string
		bytes     int64
		err       error
	}
	results := make(chan copyResult, 2)
	proxyCopy := func(dst, src net.Conn, direction string) {
		buf := copyBufPool.Get().([]byte)
		copied, copyErr := io.CopyBuffer(dst, src, buf)
		copyBufPool.Put(buf)
		results <- copyResult{direction: direction, bytes: copied, err: copyErr}
	}
	go proxyCopy(challengeConn, clientConn, "c2s")
	go proxyCopy(clientConn, challengeConn, "s2c")

	var bytesC2S, bytesS2C int64
	for i := 0; i < 2; i++ {
		result := <-results
		if result.direction == "c2s" {
			bytesC2S = result.bytes
		} else {
			bytesS2C = result.bytes
		}
		if result.err != nil {
			setTermination(copyTermination(result.direction, result.err))
		} else if result.direction == "c2s" {
			setTermination("client_disconnect")
		} else {
			setTermination("upstream_disconnect")
		}
		closeOnce.Do(closeAll)
	}
	cancelExpiry()

	terminationMu.Lock()
	reason := terminationReason
	terminationMu.Unlock()
	emitTCPEventWithStats("tcp_session_end", sessionID, clientIP, &payload, bytesC2S, bytesS2C, time.Since(startedAt), reason)
}

func emitTCPEvent(eventName, sessionID, peerIP string, payload *token.Payload, outcome, errorCode string) {
	event := telemetry.New(eventName, "tcp")
	event.SessionID = sessionID
	event.PeerIP = peerIP
	event.IPSource = "remote_addr"
	event.Outcome = outcome
	event.ErrorCode = errorCode
	addTCPIdentity(&event, payload)
	telemetry.Emit(event)
}

func emitTCPEventWithStats(eventName, sessionID, peerIP string, payload *token.Payload, bytesC2S, bytesS2C int64, duration time.Duration, reason string) {
	event := telemetry.New(eventName, "tcp")
	event.SessionID = sessionID
	event.PeerIP = peerIP
	event.IPSource = "remote_addr"
	event.BytesC2S = bytesC2S
	event.BytesS2C = bytesS2C
	event.DurationMS = duration.Milliseconds()
	event.Outcome = "ended"
	event.TerminationReason = reason
	addTCPIdentity(&event, payload)
	telemetry.Emit(event)
}

func addTCPIdentity(event *telemetry.Event, payload *token.Payload) {
	if payload == nil || !validTCPNamespace(payload.Route) {
		return
	}
	event.InstanceNamespace = payload.Route
	event.AuthStrength = "signed_route"
	event.ChallengeID = payload.ChallengeID
	event.ActorTeamID = payload.ActorTeamID
	if payload.ChallengeID == nil || payload.ActorTeamID == nil {
		teamID, challengeID, ok := ParseTeamChallengeFromRoute(payload.Route)
		if ok {
			if event.ChallengeID == nil {
				id := challengeID
				event.ChallengeID = &id
			}
			if teamID > 0 && event.ActorTeamID == nil {
				id := teamID
				event.ActorTeamID = &id
			}
		}
	}
	if event.ChallengeID == nil {
		event.AuthStrength = "legacy"
	}
}

func validTCPNamespace(route string) bool {
	return requestlog.ValidNamespace(route)
}

func authErrorCode(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "timed out"):
		return "authentication_timeout"
	case strings.Contains(message, "token expired"):
		return "token_expired"
	case strings.Contains(message, "too long"):
		return "token_too_long"
	case strings.Contains(message, "empty token"):
		return "missing_assertion"
	default:
		return "invalid_assertion"
	}
}

func copyTermination(direction string, err error) string {
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return "proxy_timeout"
	}
	if direction == "c2s" {
		return "client_disconnect"
	}
	return "upstream_disconnect"
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
	tok := strings.TrimSpace(input)
	if tok == "" {
		return token.Payload{}, "", fmt.Errorf("empty token")
	}
	payload, err := token.Verify(tok)
	if err != nil {
		return token.Payload{}, "", err
	}
	return payload, tok, nil
}
