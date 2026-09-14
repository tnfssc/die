package core

import (
	"context"
	"encoding/json"
	"time"
)

type Message struct {
	Hidden     bool            `json:"hidden,omitempty"`
	Role       string          `json:"role"`
	Content    string          `json:"content,omitempty"`
	ToolCalls  []ToolCall      `json:"toolCalls,omitempty"`
	ToolCallID string          `json:"toolCallId,omitempty"`
	Native     json.RawMessage `json:"native,omitempty"`
	Provider   string          `json:"provider,omitempty"`
	Model      string          `json:"model,omitempty"`
	Images     []Image         `json:"images,omitempty"`
}
type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}
type Image struct {
	MIME string `json:"mimeType"`
	Data string `json:"data"`
}
type Usage struct {
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	CacheRead  int64   `json:"cacheRead"`
	CacheWrite int64   `json:"cacheWrite"`
	Cost       float64 `json:"cost"`
}
type Request struct {
	Provider  string
	System    string
	Messages  []Message
	Model     string
	Thinking  string
	SessionID string
	MaxTokens int
	Fast      bool
}
type Response struct {
	Message    Message
	Usage      Usage
	StopReason string
	ResponseID string
}
type StreamEvent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	Data any    `json:"data,omitempty"`
}
type Provider interface {
	Complete(context.Context, Request, func(StreamEvent)) (Response, error)
}
type ExecuteResult struct {
	Output         string  `json:"output"`
	Images         []Image `json:"images,omitempty"`
	ExitCode       int     `json:"exitCode"`
	Handoff        bool    `json:"handoff,omitempty"`
	HandoffMessage string  `json:"handoffMessage,omitempty"`
	Error          string  `json:"error,omitempty"`
}
type Helper func(context.Context, string, json.RawMessage) (any, error)
type Executor interface {
	Execute(context.Context, string, time.Duration) (ExecuteResult, error)
}
