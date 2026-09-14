// Package runtime owns durable child jobs and isolated Bun execute workers.
package runtime

import (
	"context"
	"encoding/json"
	"godie/internal/core"
	"time"
)

type Config struct {
	CWD, StateDir, SessionFile, BunPath string
	Helper                              core.Helper
	KillGrace, ShutdownTimeout          time.Duration
}
type AgentInfo struct {
	Type              string `json:"type"`
	Model             string `json:"model,omitempty"`
	Thinking          string `json:"thinking,omitempty"`
	Depth             int    `json:"depth"`
	SessionFile       string `json:"sessionFile"`
	ParentSessionFile string `json:"parentSessionFile,omitempty"`
	Phase             string `json:"phase,omitempty"`
}

// LaunchOptions describes a direct argv launch. Agent callers can reserve ID and
// persist SessionFile before spawning, then pass both here without shell quoting.
type LaunchOptions struct {
	ID, Kind, CWD, DisplayCommand, CallerID string
	Env                                     map[string]string
	Timeout                                 time.Duration
	CloseInput                              bool
	Agent                                   *AgentInfo
}

type Event struct {
	Type string `json:"type"`
	Job  Job    `json:"job"`
}
type Job struct {
	ID             string       `json:"id"`
	Kind           string       `json:"kind"`
	Command        string       `json:"command"`
	CallerID       string       `json:"callerId,omitempty"`
	Agent          *AgentInfo   `json:"agent,omitempty"`
	SessionFile    string       `json:"sessionFile,omitempty"`
	CWD            string       `json:"cwd"`
	PID            int          `json:"pid,omitempty"`
	Status         string       `json:"status"`
	StartedAt      string       `json:"startedAt"`
	CompletedAt    string       `json:"completedAt,omitempty"`
	ExitCode       int          `json:"exitCode"`
	Signal         string       `json:"signal,omitempty"`
	BaseOffset     int64        `json:"baseOffset"`
	OutputEnd      int64        `json:"outputEnd"`
	TimedOut       bool         `json:"timedOut"`
	LastActivityAt string       `json:"lastActivityAt,omitempty"`
	StdinOpen      bool         `json:"stdinOpen"`
	Termination    *Termination `json:"termination,omitempty"`
	WatchEnabled   bool         `json:"watchEnabled,omitempty"`
}
type Termination struct {
	Cause       string `json:"cause"`
	RequestedAt string `json:"requestedAt"`
}
type Inspection struct {
	Job
	Output          string `json:"output"`
	RequestedOffset int64  `json:"requestedOffset"`
	NextOffset      int64  `json:"nextOffset"`
	OutputLost      bool   `json:"outputLost"`
	HasMore         bool   `json:"hasMore"`
	Background      bool   `json:"background"`
	ElapsedMS       int64  `json:"elapsedMs"`
}
type callArgs map[string]json.RawMessage

func (r *Runtime) Call(ctx context.Context, method string, args json.RawMessage) (any, error) {
	return r.call(ctx, method, args)
}
