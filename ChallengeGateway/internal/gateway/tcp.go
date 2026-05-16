package gateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
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
	// Memory pool for copy buffers reduces GC pressure under load.
	copyBufPool := &sync.Pool{
		New: func() any { return make([]byte, copyBufBytes) },
	}

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
		fmt.Printf("[*] TCP Gateway running on port %s (TLS enabled)...\n", tcpListenAddr)
	} else {
		fmt.Printf("[*] TCP Gateway running on port %s...\n", tcpListenAddr)
	}

	// Close listener when context is cancelled.
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	// Semaphore limits total goroutines (and thus OS resources) per config.
	sem := make(chan struct{}, cfg.TCPMaxConns)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				if ctx.Err() != nil {
					return // shutting down
				}
				continue
			}

			ip := ParseRemoteIP(conn.RemoteAddr().String())

			if limiters != nil && limiters.TCPRate != nil && !limiters.TCPRate.Allow(context.Background(), ip) {
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPIPConn != nil && !limiters.TCPIPConn.Acquire(context.Background(), ip) {
				_ = conn.Close()
				continue
			}
			if limiters != nil && limiters.TCPGlobalConn != nil && !limiters.TCPGlobalConn.Acquire(context.Background(), "global") {
				if limiters.TCPIPConn != nil {
					limiters.TCPIPConn.Release(context.Background(), ip)
				}
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

	remoteAddr := clientConn.RemoteAddr().String()
	clientIP := ParseRemoteIP(remoteAddr)
	log.Printf("[+] TCP connection from %s proto=\"tcp\" event=\"connect\"", remoteAddr)

	if rawConnProvider, ok := clientConn.(interface{ RawConn() net.Conn }); ok {
		if tcpConn, ok := rawConnProvider.RawConn().(*net.TCPConn); ok {
			_ = tcpConn.SetKeepAlive(true)
			_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
		}
	} else if tcpConn, ok := clientConn.(*net.TCPConn); ok {
		_ = tcpConn.SetKeepAlive(true)
		_ = tcpConn.SetKeepAlivePeriod(30 * time.Second)
	}

	pending := atomic.AddInt64(&tcpPendingAuth, 1)
	log.Printf("[*] TCP pending auth connections: %d", pending)
	defer func() {
		p := atomic.AddInt64(&tcpPendingAuth, -1)
		log.Printf("[*] TCP pending auth connections: %d", p)
	}()

	payload, tok, err := authenticateTCPClient(clientConn, authTimeout)
	if err != nil {
		fmt.Fprintln(clientConn, "Auth failed!")
		log.Printf("[-] Auth failed from %s proto=\"tcp\" event=\"auth_failed\": %v", remoteAddr, err)
		return
	}

	if limiters != nil && limiters.TCPRate != nil {
		if !limiters.TCPRate.Allow(context.Background(), BuildRateLimitKey(tok, clientIP)) {
			fmt.Fprintln(clientConn, "Rate limit exceeded")
			return
		}
	}
	if limiters != nil && limiters.TCPTokenConn != nil && tok != "" {
		if !limiters.TCPTokenConn.Acquire(context.Background(), tok) {
			fmt.Fprintln(clientConn, "Too many connections for token")
			return
		}
		defer limiters.TCPTokenConn.Release(context.Background(), tok)
	}

	host := token.ExpandRoute(payload.Route)
	teamID, challengeID, ok := ParseTeamChallengeFromRoute(payload.Route)
	if !ok {
		teamID, challengeID, ok = ParseTeamChallengeFromRoute(host)
	}
	if ok {
		log.Printf("[+] Auth OK from %s team=\"%d\" challenge=\"%d\" proto=\"tcp\" event=\"auth_ok\" -> %s", remoteAddr, teamID, challengeID, host)
	} else {
		log.Printf("[+] Auth OK from %s proto=\"tcp\" event=\"auth_ok\" -> %s", remoteAddr, host)
	}

	fmt.Fprintf(clientConn, "Access Granted! Connecting to challenge...\n")
	challengeConn, err := net.Dial("tcp", host)
	if err != nil {
		fmt.Fprintf(clientConn, "[!] Could not connect to challenge server.\n")
		if ok {
			log.Printf("[-] Dial failed from %s team=\"%d\" challenge=\"%d\" proto=\"tcp\" event=\"dial_failed\" -> %s: %v", remoteAddr, teamID, challengeID, host, err)
		} else {
			log.Printf("[-] Dial failed from %s proto=\"tcp\" event=\"dial_failed\" -> %s: %v", remoteAddr, host, err)
		}
		return
	}
	defer challengeConn.Close()

	done := make(chan struct{}, 2)
	var closeOnce sync.Once
	closeAll := func() {
		_ = clientConn.Close()
		_ = challengeConn.Close()
	}

	// Auto-close session when the token expires.
	expiry := time.Unix(payload.Exp, 0)
	untilExpiry := time.Until(expiry)
	if untilExpiry <= 0 {
		if ok {
			log.Printf("[-] Token already expired for %s team=\"%d\" challenge=\"%d\" proto=\"tcp\" event=\"token_expired\" -> %s", remoteAddr, teamID, challengeID, host)
		} else {
			log.Printf("[-] Token already expired for %s proto=\"tcp\" event=\"token_expired\" -> %s", remoteAddr, host)
		}
		closeOnce.Do(closeAll)
		return
	}

	expiryCtx, cancelExpiry := context.WithCancel(context.Background())
	defer cancelExpiry()
	expiryTimer := time.NewTimer(untilExpiry)
	defer func() {
		if !expiryTimer.Stop() {
			select {
			case <-expiryTimer.C:
			default:
			}
		}
	}()

	go func() {
		select {
		case <-expiryTimer.C:
			if ok {
				log.Printf("[*] Token expired; closing session for %s team=\"%d\" challenge=\"%d\" proto=\"tcp\" event=\"session_expired\" -> %s", remoteAddr, teamID, challengeID, host)
			} else {
				log.Printf("[*] Token expired; closing session for %s proto=\"tcp\" event=\"session_expired\" -> %s", remoteAddr, host)
			}
			closeOnce.Do(closeAll)
		case <-expiryCtx.Done():
		}
	}()

	proxyCopy := func(dst, src net.Conn, direction string) {
		buf := copyBufPool.Get().([]byte)
		sampleLimit := 0
		if direction == "c2s" {
			sampleLimit = 32768 // log up to 32 KB of client→server data per connection
		}
		copied, sampleB64, copyErr := proxyCopyWithSample(dst, src, buf, sampleLimit)
		copyBufPool.Put(buf)

		// errSuffix is appended when there is no b64 sample (e.g. s2c disconnect).
		// errB64Suffix is a separate space-prefixed field used when a b64 sample IS
		// present, so the b64 value is cleanly terminated by a space and not glued
		// to the error text (which would make it unparseable / invalid base64).
		errSuffix := ""
		errB64Suffix := ""
		if copyErr != nil {
			errSuffix = ": " + copyErr.Error()
			errB64Suffix = fmt.Sprintf(" conn_err=%q", copyErr.Error())
		}
		if ok {
			if sampleB64 != "" {
				log.Printf("[~] TCP proxy %s from %s team=\"%d\" challenge=\"%d\" ns=\"%s\" proto=\"tcp\" direction=\"%s\" bytes=%d sample_b64=%s%s",
					direction, remoteAddr, teamID, challengeID, payload.Route, direction, copied, sampleB64, errB64Suffix)
			} else {
				log.Printf("[~] TCP proxy %s from %s team=\"%d\" challenge=\"%d\" ns=\"%s\" proto=\"tcp\" direction=\"%s\" bytes=%d%s",
					direction, remoteAddr, teamID, challengeID, payload.Route, direction, copied, errSuffix)
			}
		} else {
			if sampleB64 != "" {
				log.Printf("[~] TCP proxy %s from %s ns=\"%s\" proto=\"tcp\" direction=\"%s\" bytes=%d sample_b64=%s%s",
					direction, remoteAddr, payload.Route, direction, copied, sampleB64, errB64Suffix)
			} else {
				log.Printf("[~] TCP proxy %s from %s ns=\"%s\" proto=\"tcp\" direction=\"%s\" bytes=%d%s",
					direction, remoteAddr, payload.Route, direction, copied, errSuffix)
			}
		}

		closeOnce.Do(closeAll)
		done <- struct{}{}
	}

	go proxyCopy(challengeConn, clientConn, "c2s")
	go proxyCopy(clientConn, challengeConn, "s2c")

	<-done
	cancelExpiry()

	if ok {
		log.Printf("[+] Session ended: %s team=\"%d\" challenge=\"%d\" proto=\"tcp\" event=\"session_end\"", remoteAddr, teamID, challengeID)
	} else {
		log.Printf("[+] Session ended: %s proto=\"tcp\" event=\"session_end\"", remoteAddr)
	}
}

// proxyCopyWithSample copies src → dst using buf, optionally capturing the first
// sampleLimit bytes of data for logging.
func proxyCopyWithSample(dst io.Writer, src io.Reader, buf []byte, sampleLimit int) (bytesCopied int64, sampleB64 string, err error) {
	if sampleLimit < 0 {
		sampleLimit = 0
	}
	var sample bytes.Buffer
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			bytesCopied += int64(n)
			if sampleLimit > 0 && sample.Len() < sampleLimit {
				remain := sampleLimit - sample.Len()
				if n < remain {
					_, _ = sample.Write(buf[:n])
				} else {
					_, _ = sample.Write(buf[:remain])
				}
			}
			if _, writeErr := dst.Write(buf[:n]); writeErr != nil {
				err = writeErr
				break
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				err = readErr
			}
			break
		}
	}
	if sample.Len() > 0 {
		sampleB64 = base64.RawStdEncoding.EncodeToString(sample.Bytes())
	}
	return bytesCopied, sampleB64, err
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
