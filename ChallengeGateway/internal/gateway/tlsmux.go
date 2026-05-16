package gateway

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"net"
	"sync"

	"challenge-gateway/internal/config"
)

func gatewayTLSConfig(cfg config.Config) (*tls.Config, error) {
	if cfg.GatewayTLSCertFile == "" && cfg.GatewayTLSKeyFile == "" {
		return nil, nil
	}
	if cfg.GatewayTLSCertFile == "" || cfg.GatewayTLSKeyFile == "" {
		return nil, fmt.Errorf("both GATEWAY_TLS_CERT_FILE and GATEWAY_TLS_KEY_FILE must be set")
	}

	cert, err := tls.LoadX509KeyPair(cfg.GatewayTLSCertFile, cfg.GatewayTLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load gateway TLS certificate: %w", err)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func newGatewayListener(base net.Listener, tlsConfig *tls.Config) net.Listener {
	if tlsConfig == nil {
		return base
	}
	return &protocolMuxListener{Listener: base, tlsConfig: tlsConfig}
}

type protocolMuxListener struct {
	net.Listener
	tlsConfig *tls.Config
}

func (l *protocolMuxListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}

	return wrapGatewayConn(conn, l.tlsConfig), nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) {
	return c.reader.Read(p)
}

type lazyGatewayConn struct {
	net.Conn
	reader   *bufio.Reader
	tlsConfig *tls.Config
	tlsConn  net.Conn
	once     sync.Once
	modeErr  error
	useTLS   bool
}

func (c *lazyGatewayConn) ensureMode() error {
	c.once.Do(func() {
		if c.tlsConfig == nil {
			return
		}

		header, err := c.reader.Peek(5)
		if err != nil {
			c.modeErr = err
			return
		}
		if !looksLikeTLSClientHello(header) {
			return
		}

		c.useTLS = true
		tlsConn := tls.Server(&bufferedConn{Conn: c.Conn, reader: c.reader}, c.tlsConfig)
		if err := tlsConn.Handshake(); err != nil {
			c.modeErr = err
			return
		}
		c.tlsConn = tlsConn
	})

	return c.modeErr
}

func (c *lazyGatewayConn) RawConn() net.Conn {
	return c.Conn
}

func (c *lazyGatewayConn) Read(p []byte) (int, error) {
	if err := c.ensureMode(); err != nil {
		return 0, err
	}
	if c.useTLS {
		return c.tlsConn.Read(p)
	}
	return c.reader.Read(p)
}

func (c *lazyGatewayConn) Write(p []byte) (int, error) {
	if err := c.ensureMode(); err != nil {
		return 0, err
	}
	if c.useTLS {
		return c.tlsConn.Write(p)
	}
	return c.Conn.Write(p)
}

func (c *lazyGatewayConn) Close() error {
	if c.useTLS && c.tlsConn != nil {
		return c.tlsConn.Close()
	}
	return c.Conn.Close()
}

func wrapGatewayConn(conn net.Conn, tlsConfig *tls.Config) net.Conn {
	if tlsConfig == nil {
		return conn
	}

	return &lazyGatewayConn{Conn: conn, reader: bufio.NewReader(conn), tlsConfig: tlsConfig}
}

func looksLikeTLSClientHello(header []byte) bool {
	if len(header) < 5 {
		return false
	}

	return header[0] == 0x16 && header[1] == 0x03 && header[2] >= 0x00 && header[2] <= 0x04
}