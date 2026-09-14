package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
)

func postJSON(ctx context.Context, c *http.Client, url string, headers map[string]string, body any) (*http.Response, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		return nil, safeHTTPError(resp.StatusCode, b)
	}
	return resp, nil
}
func readSSE(ctx context.Context, r io.Reader, fn func(string, []byte) error) error {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 64<<10), 16<<20)
	var event string
	var data []byte
	flush := func() error {
		if len(data) == 0 {
			event = ""
			return nil
		}
		d := bytes.TrimSuffix(data, []byte("\n"))
		err := fn(event, d)
		event = ""
		data = nil
		return err
	}
	for s.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		line := s.Text()
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(line[6:])
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(line[5:])...)
			data = append(data, '\n')
		}
	}
	if err := s.Err(); err != nil {
		return err
	}
	return flush()
}
func unsupported(reqFast bool) error {
	if reqFast {
		return errors.New("provider: fast/premium service tier is unsupported")
	}
	return nil
}

func sniffSSE(r io.Reader) (io.Reader, bool, error) {
	br := bufio.NewReader(r)
	// Read at most one bounded bufio fragment and replay it. This recognizes the
	// actual wire framing without waiting for a Content-Type-correct proxy.
	prefix, err := br.ReadSlice('\n')
	if err != nil && err != io.EOF && err != bufio.ErrBufferFull {
		return nil, false, err
	}
	replay := io.MultiReader(bytes.NewReader(prefix), br)
	trimmed := bytes.TrimPrefix(prefix, []byte{0xef, 0xbb, 0xbf})
	trimmed = bytes.TrimSpace(trimmed)
	return replay, bytes.HasPrefix(trimmed, []byte("event:")) || bytes.HasPrefix(trimmed, []byte("data:")), nil
}

var secretPattern = regexp.MustCompile(`(?i)(?:bearer\s+|sk-|refresh[_ .-]?token[=: ]+|access[_ .-]?token[=: ]+)[^\s,;"}]{4,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?`)

// safeHTTPError exposes only documented scalar error fields. It never includes an
// unstructured response body, and bounds/redacts even those allowlisted values.
func safeHTTPError(status int, body []byte) error {
	var envelope struct {
		Error struct {
			Message string          `json:"message"`
			Type    string          `json:"type"`
			Code    json.RawMessage `json:"code"`
			Param   json.RawMessage `json:"param"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return fmt.Errorf("provider: HTTP status %d", status)
	}
	parts := make([]string, 0, 4)
	appendField := func(name, value string) {
		value = strings.Join(strings.Fields(value), " ")
		value = secretPattern.ReplaceAllString(value, "[redacted]")
		runes := []rune(value)
		if len(runes) > 240 {
			value = string(runes[:240]) + "…"
		}
		if value != "" {
			parts = append(parts, name+"="+value)
		}
	}
	appendField("message", envelope.Error.Message)
	appendField("type", jsonScalar(envelope.Error.Type))
	appendField("code", rawScalar(envelope.Error.Code))
	appendField("param", rawScalar(envelope.Error.Param))
	if len(parts) == 0 {
		return fmt.Errorf("provider: HTTP status %d", status)
	}
	return fmt.Errorf("provider: HTTP status %d (%s)", status, strings.Join(parts, ", "))
}

func jsonScalar(s string) string { return s }
func rawScalar(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var n json.Number
	if json.Unmarshal(raw, &n) == nil {
		return n.String()
	}
	return ""
}
