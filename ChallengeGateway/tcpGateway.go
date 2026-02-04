package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net"
	"strconv"
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
	remoteAddr := clientConn.RemoteAddr().String()
	clientIP := parseRemoteIP(remoteAddr)
	log.Printf("[+] TCP connection from %s", remoteAddr)

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
		log.Printf("[-] Auth failed from %s: %v", remoteAddr, err)
		return
	}
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
	teamID, challengeID, ok := parseTeamChallengeFromRoute(payload.Route)
	if !ok {
		teamID, challengeID, ok = parseTeamChallengeFromRoute(host)
	}
	if ok {
		log.Printf("[+] Auth OK from %s team=%d challenge=%d -> %s", remoteAddr, teamID, challengeID, host)
	} else {
		log.Printf("[+] Auth OK from %s -> %s", remoteAddr, host)
	}

	fmt.Fprintf(clientConn, "Access Granted! Connecting to challenge...\n")
	challengeConn, err := net.Dial("tcp", host)
	if err != nil {
		fmt.Fprintf(clientConn, "[!] Could not connect to challenge server.\n")
		if ok {
			log.Printf("[-] Dial failed from %s team=%d challenge=%d -> %s: %v", remoteAddr, teamID, challengeID, host, err)
		} else {
			log.Printf("[-] Dial failed from %s -> %s: %v", remoteAddr, host, err)
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
	proxyCopy := func(dst, src net.Conn, direction string) {
		buf := tcpCopyBufPool.Get().([]byte)
		sampleLimit := 0
		var onSample func(sampleB64 string, sampleBytes int)
		if direction == "c2s" {
			sampleLimit = 256
			onSample = func(sampleB64 string, sampleBytes int) {
				if ok {
					log.Printf("[~] TCP proxy %s sample from %s team=%d challenge=%d -> %s sample_bytes=%d sample_b64=%s", direction, remoteAddr, teamID, challengeID, host, sampleBytes, sampleB64)
				} else {
					log.Printf("[~] TCP proxy %s sample from %s -> %s sample_bytes=%d sample_b64=%s", direction, remoteAddr, host, sampleBytes, sampleB64)
				}
			}
		}
		bytesCopied, sampleB64, copyErr := proxyCopyWithSample(dst, src, buf, sampleLimit, onSample)
		tcpCopyBufPool.Put(buf)

		errSuffix := ""
		if copyErr != nil {
			errSuffix = ": " + copyErr.Error()
		}

		if ok {
			if sampleB64 != "" {
				log.Printf("[~] TCP proxy %s from %s team=%d challenge=%d bytes=%d sample_b64=%s%s", direction, remoteAddr, teamID, challengeID, bytesCopied, sampleB64, errSuffix)
			} else {
				log.Printf("[~] TCP proxy %s from %s team=%d challenge=%d bytes=%d%s", direction, remoteAddr, teamID, challengeID, bytesCopied, errSuffix)
			}
		} else {
			if sampleB64 != "" {
				log.Printf("[~] TCP proxy %s from %s bytes=%d sample_b64=%s%s", direction, remoteAddr, bytesCopied, sampleB64, errSuffix)
			} else {
				log.Printf("[~] TCP proxy %s from %s bytes=%d%s", direction, remoteAddr, bytesCopied, errSuffix)
			}
		}

		closeOnce.Do(closeAll)
		done <- struct{}{}
	}

	go proxyCopy(challengeConn, clientConn, "c2s")
	go proxyCopy(clientConn, challengeConn, "s2c")

	<-done
	log.Printf("[+] Session ended: %s", remoteAddr)
}

func proxyCopyWithSample(dst io.Writer, src io.Reader, buf []byte, sampleLimit int, onSample func(sampleB64 string, sampleBytes int)) (bytesCopied int64, sampleB64 string, err error) {
	if sampleLimit < 0 {
		sampleLimit = 0
	}
	var sample bytes.Buffer
	sampleLogged := false
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

			if !sampleLogged && onSample != nil && sample.Len() > 0 {
				sampleLogged = true
				onSample(base64.RawStdEncoding.EncodeToString(sample.Bytes()), sample.Len())
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

func parseTeamChallengeFromRoute(routeOrHost string) (teamID int, challengeID int, ok bool) {
	name := strings.TrimSpace(routeOrHost)
	if name == "" {
		return 0, 0, false
	}

	// If this is host:port, strip the port.
	if h, _, err := net.SplitHostPort(name); err == nil {
		name = h
	} else {
		// Best-effort: strip a single trailing ":port" for typical k8s DNS names.
		if i := strings.LastIndexByte(name, ':'); i > 0 {
			name = name[:i]
		}
	}

	// For k8s service DNS, take the service label (left-most) and remove "-svc".
	if i := strings.IndexByte(name, '.'); i > 0 {
		name = name[:i]
	}
	name = strings.TrimSuffix(name, "-svc")

	parts := strings.Split(name, "-")
	if len(parts) < 3 {
		return 0, 0, false
	}
	if parts[0] != "team" {
		return 0, 0, false
	}

	t, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	c, err := strconv.Atoi(parts[2])
	if err != nil {
		return 0, 0, false
	}

	return t, c, true
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

