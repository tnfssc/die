package herdr

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type captured struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

type fakeServer struct {
	listener *net.UnixListener
	mu       sync.Mutex
	requests []captured
	done     chan struct{}
}

func serve(t *testing.T, reply bool) (*fakeServer, string) {
	t.Helper()
	// Avoid Go test-name paths exceeding the Unix socket sockaddr limit when
	// TMPDIR is on a longer, non-/tmp filesystem. This directory is test-owned.
	dir, err := os.MkdirTemp("", "herdr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "herdr.sock")
	addr, err := net.ResolveUnixAddr("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenUnix("unix", addr)
	if err != nil {
		t.Fatal(err)
	}
	s := &fakeServer{listener: listener, done: make(chan struct{})}
	go func() {
		defer close(s.done)
		for {
			conn, err := listener.AcceptUnix()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				line, err := bufio.NewReader(conn).ReadBytes('\n')
				if err != nil {
					return
				}
				var request captured
				if json.Unmarshal(line, &request) != nil {
					return
				}
				s.mu.Lock()
				s.requests = append(s.requests, request)
				s.mu.Unlock()
				if reply {
					_, _ = conn.Write([]byte("{\"ok\":true}\n"))
				} else {
					time.Sleep(time.Second)
				}
			}()
		}
	}()
	t.Cleanup(func() { _ = listener.Close(); <-s.done })
	return s, path
}

func (s *fakeServer) snapshot() []captured {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]captured(nil), s.requests...)
}
func waitRequests(t *testing.T, s *fakeServer, n int) []captured {
	t.Helper()
	until := time.Now().Add(time.Second)
	for time.Now().Before(until) {
		if requests := s.snapshot(); len(requests) >= n {
			return requests
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("wanted %d Herdr requests, got %d", n, len(s.snapshot()))
	return nil
}

func TestWireLifecycleSessionStateAndRelease(t *testing.T) {
	server, path := serve(t, true)
	a, err := New(Config{SocketPath: path, PaneID: "pane-root"})
	if err != nil {
		t.Fatal(err)
	}
	a.Session("/tmp/session.jsonl", "fallback")
	waitRequests(t, server, 1)
	a.State(Working, "must not be sent")
	waitRequests(t, server, 2)
	a.State(Blocked, "approval\x00 required")
	waitRequests(t, server, 3)
	a.State(Idle, "must not be sent")
	waitRequests(t, server, 4)
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}

	requests := waitRequests(t, server, 5)
	methods := []string{"pane.report_agent_session", "pane.report_agent", "pane.report_agent", "pane.report_agent", "pane.release_agent"}
	lastSeq := float64(0)
	for i, request := range requests {
		if request.Method != methods[i] {
			t.Fatalf("request %d method = %q", i, request.Method)
		}
		if request.Params["pane_id"] != "pane-root" || request.Params["source"] != "herdr:die" || request.Params["agent"] != "pi" {
			t.Fatalf("bad identity: %#v", request.Params)
		}
		seq, ok := request.Params["seq"].(float64)
		if !ok || seq <= lastSeq {
			t.Fatalf("non-monotonic seq %#v", request.Params["seq"])
		}
		lastSeq = seq
	}
	if requests[0].Params["agent_session_path"] != "/tmp/session.jsonl" {
		t.Fatalf("bad session: %#v", requests[0].Params)
	}
	if requests[2].Params["state"] != "blocked" || requests[2].Params["message"] != "approval  required" {
		t.Fatalf("bad blocked state: %#v", requests[2].Params)
	}
	if _, ok := requests[3].Params["message"]; ok {
		t.Fatal("idle state disclosed a message")
	}
	if _, ok := requests[4].Params["state"]; ok {
		t.Fatal("release included a state")
	}
}

func isolatedEnvironment(t *testing.T, path string) {
	t.Helper()
	t.Setenv("HERDR_ENV", "1")
	t.Setenv("HERDR_SOCKET_PATH", path)
	t.Setenv("HERDR_PANE_ID", "pane")
	t.Setenv("DIE_SUBAGENT_DEPTH", "0")
	t.Setenv("DIE_SUBAGENT_TYPE", "")
}

func TestFromEnvironmentDisablesChildHeadlessAndMalformed(t *testing.T) {
	_, path := serve(t, true)
	isolatedEnvironment(t, path)
	for _, tc := range []struct {
		name              string
		root, interactive bool
	}{{"child", false, true}, {"headless", true, false}} {
		t.Run(tc.name, func(t *testing.T) {
			a, err := FromEnvironment(tc.root, tc.interactive)
			if err != nil || a != nil {
				t.Fatalf("got adapter %#v, error %v", a, err)
			}
		})
	}
	t.Setenv("DIE_SUBAGENT_DEPTH", "1")
	if a, err := FromEnvironment(true, true); err != nil || a != nil {
		t.Fatalf("inherited child enabled: %#v %v", a, err)
	}
	t.Setenv("DIE_SUBAGENT_DEPTH", "bad")
	if a, err := FromEnvironment(true, true); err != nil || a != nil {
		t.Fatalf("malformed child depth enabled: %#v %v", a, err)
	}
	t.Setenv("DIE_SUBAGENT_DEPTH", "0")
	t.Setenv("DIE_SUBAGENT_TYPE", "normal")
	if a, err := FromEnvironment(true, true); err != nil || a != nil {
		t.Fatalf("child role enabled: %#v %v", a, err)
	}
}

func TestEnvironmentOptInAndSessionID(t *testing.T) {
	server, path := serve(t, true)
	isolatedEnvironment(t, path)
	a, err := FromEnvironment(true, true)
	if err != nil || a == nil {
		t.Fatalf("adapter = %#v, error %v", a, err)
	}
	a.Session("relative", "session-id")
	waitRequests(t, server, 1)
	_ = a.Close()
	requests := waitRequests(t, server, 2)
	if requests[0].Params["agent_session_id"] != "session-id" {
		t.Fatalf("bad id session: %#v", requests[0].Params)
	}
}

func TestMissingAndSlowSocketsAreBoundedAndNonfatal(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.sock")
	a, err := New(Config{SocketPath: missing, PaneID: "pane", FirstTimeout: 20 * time.Millisecond, RetryTimeout: 30 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	a.State(Working, "")
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 250*time.Millisecond {
		t.Fatalf("missing socket took %v", elapsed)
	}

	server, path := serve(t, false)
	slow, err := New(Config{SocketPath: path, PaneID: "pane", FirstTimeout: 20 * time.Millisecond, RetryTimeout: 30 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	start = time.Now()
	slow.Session("", "slow")
	waitRequests(t, server, 1)
	if err := slow.Close(); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
		t.Fatalf("slow socket took %v", elapsed)
	}
	requests := waitRequests(t, server, 2)
	if requests[len(requests)-1].Method != "pane.release_agent" {
		t.Fatalf("final request = %q", requests[len(requests)-1].Method)
	}
}
