// Package herdr provides optional lifecycle reporting to a local Herdr pane.
// It has no process-wide initialization: callers must explicitly opt in.
package herdr

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
)

const (
	maxPaneID           = 512
	maxSessionPath      = 4096
	maxSessionID        = 512
	maxMessage          = 512
	maxSocketPath       = 4096
	defaultFirstTimeout = 250 * time.Millisecond
	defaultRetryTimeout = 750 * time.Millisecond
	source              = "herdr:die"
	agent               = "pi"
)

// AgentState is a pane lifecycle state understood by Herdr.
type AgentState string

const (
	Working AgentState = "working"
	Idle    AgentState = "idle"
	Blocked AgentState = "blocked"
)

// DialFunc exists primarily for embedders. The default uses net.DialUnix.
type DialFunc func(path string, timeout time.Duration) (*net.UnixConn, error)

// Config configures one pane reporter. Empty timeout fields use short defaults.
type Config struct {
	SocketPath   string
	PaneID       string
	FirstTimeout time.Duration
	RetryTimeout time.Duration
	Dial         DialFunc
}

type request struct {
	kind   string
	method string
	params map[string]any
	epoch  uint64
	final  bool
}
type wireRequest struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

// Adapter is safe for concurrent lifecycle calls. Session and State never wait
// for the socket; Close waits only for the bounded release attempts.
type Adapter struct {
	cfg     Config
	mu      sync.Mutex
	pending []request
	ref     map[string]any
	epoch   uint64
	closing bool
	conn    *net.UnixConn
	wake    chan struct{}
	done    chan struct{}
}

var sequence atomic.Uint64

func init() { sequence.Store(uint64(time.Now().UnixMilli()) * 1000) }

// New validates config and starts a dormant reporting pump. It does not dial
// until Session, State, or Close is called.
func New(cfg Config) (*Adapter, error) {
	if strings.TrimSpace(cfg.SocketPath) == "" || len(cfg.SocketPath) > maxSocketPath || strings.IndexByte(cfg.SocketPath, 0) >= 0 {
		return nil, errors.New("herdr: invalid socket path")
	}
	pane := bounded(cfg.PaneID, maxPaneID)
	if pane == "" {
		return nil, errors.New("herdr: invalid pane id")
	}
	if cfg.FirstTimeout < 0 || cfg.RetryTimeout < 0 {
		return nil, errors.New("herdr: negative timeout")
	}
	if cfg.FirstTimeout == 0 {
		cfg.FirstTimeout = defaultFirstTimeout
	}
	if cfg.RetryTimeout == 0 {
		cfg.RetryTimeout = defaultRetryTimeout
	}
	cfg.PaneID = pane
	if cfg.Dial == nil {
		cfg.Dial = dialUnix
	}
	a := &Adapter{cfg: cfg, wake: make(chan struct{}, 1), done: make(chan struct{})}
	go a.pump()
	return a, nil
}

// FromEnvironment enables reporting only for an explicitly identified root,
// interactive coordinator. Disabled and malformed environments return nil, nil.
func FromEnvironment(root, interactive bool) (*Adapter, error) {
	if !root || !interactive || os.Getenv("HERDR_ENV") != "1" {
		return nil, nil
	}
	rawDepth := os.Getenv("DIE_SUBAGENT_DEPTH")
	if rawDepth == "" {
		rawDepth = "0"
	}
	depth, err := strconv.Atoi(rawDepth)
	if err != nil || depth != 0 || strconv.Itoa(depth) != rawDepth || strings.TrimSpace(os.Getenv("DIE_SUBAGENT_TYPE")) != "" {
		return nil, nil
	}
	path := os.Getenv("HERDR_SOCKET_PATH")
	pane := os.Getenv("HERDR_PANE_ID")
	if strings.TrimSpace(path) == "" || len(path) > maxSocketPath || strings.IndexByte(path, 0) >= 0 || bounded(pane, maxPaneID) == "" {
		return nil, nil
	}
	return New(Config{SocketPath: path, PaneID: pane})
}

// Session reports the current session. An absolute path is preferred; id is
// used as a fallback. Invalid or empty identity does not emit a report.
func (a *Adapter) Session(path string, ids ...string) {
	if a == nil {
		return
	}
	var ref map[string]any
	id := ""
	if len(ids) > 0 {
		id = ids[0]
	} else if !filepath.IsAbs(bounded(path, maxSessionPath)) {
		id, path = path, ""
	}
	if p := bounded(path, maxSessionPath); p != "" && filepath.IsAbs(p) {
		ref = map[string]any{"agent_session_path": p}
	} else if v := bounded(id, maxSessionID); v != "" {
		ref = map[string]any{"agent_session_id": v}
	}
	if ref == nil {
		return
	}
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return
	}
	a.ref = clone(ref)
	params := a.baseLocked()
	for k, v := range ref {
		params[k] = v
	}
	a.enqueueLocked(request{kind: "session", method: "pane.report_agent_session", params: params, epoch: a.epoch})
	a.mu.Unlock()
}

// State reports working, idle, or blocked. A message is transmitted only for
// blocked state and is control-character sanitized and bounded.
func (a *Adapter) State(state AgentState, messages ...string) {
	if a == nil || (state != Working && state != Idle && state != Blocked) {
		return
	}
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return
	}
	params := a.baseLocked()
	params["state"] = string(state)
	message := ""
	if len(messages) > 0 {
		message = messages[0]
	}
	if state == Blocked {
		if text := bounded(message, maxMessage); text != "" {
			params["message"] = text
		}
	}
	for k, v := range a.ref {
		params[k] = v
	}
	a.enqueueLocked(request{kind: "state", method: "pane.report_agent", params: params, epoch: a.epoch})
	a.mu.Unlock()
}

// Close discards unsent reports, interrupts an in-flight report, sends a
// bounded pane.release_agent request, and stops the pump. Transport failures
// are intentionally nonfatal. Close is idempotent.
func (a *Adapter) Close() error {
	if a == nil {
		return nil
	}
	a.mu.Lock()
	if !a.closing {
		a.closing = true
		a.epoch++
		a.pending = nil
		if a.conn != nil {
			_ = a.conn.Close()
		}
		a.enqueueLocked(request{kind: "release", method: "pane.release_agent", params: a.baseLocked(), epoch: a.epoch, final: true})
	}
	done := a.done
	a.mu.Unlock()
	<-done
	return nil
}

func (a *Adapter) baseLocked() map[string]any {
	return map[string]any{"pane_id": a.cfg.PaneID, "source": source, "agent": agent}
}
func (a *Adapter) enqueueLocked(r request) {
	for i := range a.pending {
		if a.pending[i].kind == r.kind {
			a.pending[i] = r
			a.signalLocked()
			return
		}
	}
	a.pending = append(a.pending, r)
	a.signalLocked()
}
func (a *Adapter) signalLocked() {
	select {
	case a.wake <- struct{}{}:
	default:
	}
}

func (a *Adapter) pump() {
	defer close(a.done)
	for range a.wake {
		for {
			a.mu.Lock()
			if len(a.pending) == 0 {
				a.mu.Unlock()
				break
			}
			r := a.pending[0]
			a.pending = a.pending[1:]
			a.mu.Unlock()
			a.send(r)
			if r.final {
				return
			}
		}
	}
}
func (a *Adapter) send(r request) {
	if a.attempt(r, a.cfg.FirstTimeout) {
		return
	}
	a.mu.Lock()
	current := r.epoch == a.epoch && (!a.closing || r.final)
	a.mu.Unlock()
	if current {
		_ = a.attempt(r, a.cfg.RetryTimeout)
	}
}
func (a *Adapter) attempt(r request, timeout time.Duration) bool {
	conn, err := a.cfg.Dial(a.cfg.SocketPath, timeout)
	if err != nil {
		return false
	}
	a.mu.Lock()
	if r.epoch != a.epoch || (a.closing && !r.final) {
		a.mu.Unlock()
		_ = conn.Close()
		return false
	}
	a.conn = conn
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		if a.conn == conn {
			a.conn = nil
		}
		a.mu.Unlock()
		_ = conn.Close()
	}()
	_ = conn.SetDeadline(time.Now().Add(timeout))
	params := clone(r.params)
	params["seq"] = sequence.Add(1)
	w := wireRequest{ID: fmt.Sprintf("%s:%s:%d", source, r.kind, sequence.Add(1)), Method: r.method, Params: params}
	data, err := json.Marshal(w)
	if err != nil {
		return false
	}
	data = append(data, '\n')
	if _, err = conn.Write(data); err != nil {
		return false
	}
	var ack [1]byte
	_, err = conn.Read(ack[:])
	return err == nil
}
func dialUnix(path string, timeout time.Duration) (*net.UnixConn, error) {
	addr, err := net.ResolveUnixAddr("unix", path)
	if err != nil {
		return nil, err
	}
	d := net.Dialer{Timeout: timeout}
	conn, err := d.Dial("unix", addr.String())
	if err != nil {
		return nil, err
	}
	u, ok := conn.(*net.UnixConn)
	if !ok {
		_ = conn.Close()
		return nil, errors.New("herdr: dial did not return a Unix connection")
	}
	return u, nil
}
func bounded(value string, limit int) string {
	value = strings.Map(func(r rune) rune {
		if (unicode.IsControl(r) && r != '\t' && r != '\n' && r != '\r') || r == unicode.ReplacementChar {
			return ' '
		}
		return r
	}, value)
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	b := []byte(value)
	if len(b) <= limit {
		return value
	}
	b = bytes.ToValidUTF8(b[:limit], nil)
	return string(b)
}
func clone(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
