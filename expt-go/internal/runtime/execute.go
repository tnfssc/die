package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"godie/internal/core"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

const executeInline = 4_000
const maxBridgeFrame = 1 << 20

var errExecuteTimedOut = errors.New("Execution timed out (SIGTERM).")

type capture struct {
	mu      sync.Mutex
	b       []byte
	spill   *os.File
	path    string
	session string
	err     string
}

func (c *capture) write(p []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.spill == nil && c.err == "" && utf8.RuneCount(c.b)+utf8.RuneCount(p) > executeInline {
		root := filepath.Join(os.TempDir(), "godie-execute")
		if c.session != "" {
			root = c.session + ".artifacts"
		}
		if e := os.MkdirAll(root, 0700); e != nil {
			c.err = "could not create output directory: " + e.Error()
		} else if f, e := os.CreateTemp(root, "output-*.log"); e != nil {
			c.err = "could not create output artifact: " + e.Error()
		} else {
			if e = f.Chmod(0600); e != nil {
				c.err = "could not protect output artifact: " + e.Error()
				_ = f.Close()
				_ = os.Remove(f.Name())
			} else {
				c.spill = f
				c.path = f.Name()
				if _, e = f.Write(c.b); e != nil {
					c.err = "could not write complete output: " + e.Error()
				}
			}
		}
	}
	if c.spill != nil && c.err == "" {
		if _, writeErr := c.spill.Write(p); writeErr != nil {
			c.err = "could not write complete output: " + writeErr.Error()
		}
	}
	c.b = append(c.b, p...)
	// Four thousand Unicode characters need at most 16,000 UTF-8 bytes. Keep a
	// little boundary slack while bounding memory after spill.
	if len(c.b) > executeInline*4+4 {
		start := len(c.b) - (executeInline*4 + 4)
		for start < len(c.b) && (c.b[start]&0xc0) == 0x80 {
			start++
		}
		c.b = append([]byte(nil), c.b[start:]...)
	}
}
func (c *capture) result() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.spill != nil {
		if e := c.spill.Sync(); e != nil && c.err == "" {
			c.err = "could not sync complete output: " + e.Error()
		}
		if e := c.spill.Close(); e != nil && c.err == "" {
			c.err = "could not close complete output: " + e.Error()
		}
		c.spill = nil
	}
	runes := []rune(string(c.b))
	if len(runes) > executeInline {
		runes = runes[len(runes)-executeInline:]
	}
	preview := string(runes)
	if c.path != "" && c.err == "" {
		return fmt.Sprintf("[output exceeded %d characters; complete output: %s]\n%s", executeInline, c.path, preview)
	}
	if c.err != "" {
		return fmt.Sprintf("[output exceeded %d characters; full output could not be saved: %s]\n%s", executeInline, c.err, preview)
	}
	return preview
}

type rpcFrame struct {
	ID     int             `json:"id"`
	Method string          `json:"method"`
	Args   json.RawMessage `json:"args"`
	Ack    *int            `json:"ack,omitempty"`
}
type rpcReply struct {
	ID     int    `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (r *Runtime) Execute(parent context.Context, code string, timeout time.Duration) (core.ExecuteResult, error) {
	select {
	case <-r.closed:
		return core.ExecuteResult{}, errors.New("runtime is closed")
	default:
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	if timeout > 0 {
		var timeoutCancel context.CancelFunc
		ctx, timeoutCancel = context.WithTimeoutCause(ctx, timeout, errExecuteTimedOut)
		defer timeoutCancel()
	}
	r.execMu.Lock()
	if r.closing {
		r.execMu.Unlock()
		return core.ExecuteResult{}, errors.New("runtime is closed")
	}
	r.execWG.Add(1)
	r.execNext++
	execID := r.execNext
	r.execCancels[execID] = cancel
	r.execMu.Unlock()
	defer func() {
		r.execMu.Lock()
		delete(r.execCancels, execID)
		r.execMu.Unlock()
		r.execWG.Done()
	}()
	reqR, reqW, e := os.Pipe()
	if e != nil {
		return core.ExecuteResult{}, e
	}
	respR, respW, e := os.Pipe()
	if e != nil {
		return core.ExecuteResult{}, e
	}
	imgR, imgW, e := os.Pipe()
	if e != nil {
		return core.ExecuteResult{}, e
	}
	entryFilename := filepath.Join(r.cfg.CWD, "__die_execute__.ts")
	if !filepath.IsAbs(entryFilename) {
		entryFilename, e = filepath.Abs(entryFilename)
		if e != nil {
			return core.ExecuteResult{}, fmt.Errorf("resolve execute entry filename: %w", e)
		}
	}
	filenameJSON, e := json.Marshal(entryFilename)
	if e != nil {
		return core.ExecuteResult{}, fmt.Errorf("encode execute entry filename: %w", e)
	}
	// Bun names stdin [stdin]. A compile-time define gives the isolated stdin
	// module the same synthetic CommonJS filename as the original runtime while
	// preserving normal lexical shadowing of __filename in user code.
	cmd := exec.Command(r.bunPath, "run", "--no-install", "--define", "__filename:"+string(filenameJSON), "--preload", r.runnerPath, "-")
	cmd.Dir = r.cfg.CWD
	cmd.Env = append(os.Environ(), "GODIE_PHOTON_DIR="+filepath.Join(filepath.Dir(r.runnerPath), "photon"))
	cmd.Stdin = bytes.NewBufferString(code)
	cmd.ExtraFiles = []*os.File{reqW, respR, imgW}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	// Own both read ends: Cmd.Wait closes StdoutPipe/StderrPipe itself,
	// which can race the pumps and silently lose a fast process's last bytes.
	outPipe, outWrite, e := os.Pipe()
	if e != nil {
		return core.ExecuteResult{}, e
	}
	defer outPipe.Close()
	defer outWrite.Close()
	errPipe, errWrite, e := os.Pipe()
	if e != nil {
		return core.ExecuteResult{}, e
	}
	defer errPipe.Close()
	defer errWrite.Close()
	cmd.Stdout = outWrite
	cmd.Stderr = errWrite
	if e = cmd.Start(); e != nil {
		return core.ExecuteResult{}, e
	}
	_ = outWrite.Close()
	_ = errWrite.Close()
	_ = reqW.Close()
	_ = respR.Close()
	_ = imgW.Close()
	defer reqR.Close()
	defer respW.Close()
	defer imgR.Close()
	var cap capture
	cap.session = r.cfg.SessionFile
	var ioWG sync.WaitGroup
	ioWG.Add(2)
	go func() { defer ioWG.Done(); _, _ = io.Copy(writerFunc(cap.write), outPipe) }()
	go func() { defer ioWG.Done(); _, _ = io.Copy(writerFunc(cap.write), errPipe) }()
	var imageMu sync.Mutex
	images := []core.Image{}
	imageErr := ""
	ioWG.Add(1)
	go func() {
		defer ioWG.Done()
		s := bufio.NewScanner(imgR)
		s.Buffer(make([]byte, 64*1024), 36_000_000)
		total := 0
		for s.Scan() {
			var im core.Image
			if e := json.Unmarshal(s.Bytes(), &im); e != nil {
				imageErr = "invalid image frame"
				continue
			}
			n := len(im.Data) * 3 / 4
			if len(images) >= 4 || total+n > 10_000_000 {
				imageErr = "image output exceeds 4 images or 10 MB"
				continue
			}
			total += n
			imageMu.Lock()
			images = append(images, im)
			imageMu.Unlock()
		}
		if e := s.Err(); e != nil {
			imageErr = e.Error()
		}
	}()
	var handoffMu sync.Mutex
	handoff := ""
	bridgeCtx, bridgeCancel := context.WithCancel(ctx)
	defer bridgeCancel()
	type delivery struct {
		owners   []string
		ack      bool
		eligible bool
	}
	deliveries := make(map[int]*delivery)
	var deliveryMu sync.Mutex
	protocolOK := true
	bridgeDone := make(chan struct{})
	go func() {
		defer close(bridgeDone)
		scanner := bufio.NewScanner(reqR)
		scanner.Buffer(make([]byte, 4096), maxBridgeFrame)
		enc := json.NewEncoder(respW)
		var writeMu sync.Mutex
		var handlers sync.WaitGroup
		for scanner.Scan() {
			var frame rpcFrame
			if err := json.Unmarshal(scanner.Bytes(), &frame); err != nil {
				deliveryMu.Lock()
				protocolOK = false
				deliveryMu.Unlock()
				break
			}
			if frame.Ack != nil {
				deliveryMu.Lock()
				d := deliveries[*frame.Ack]
				if d == nil || d.ack {
					protocolOK = false
				} else {
					d.ack = true
				}
				deliveryMu.Unlock()
				continue
			}
			if frame.ID <= 0 || frame.Method == "" {
				deliveryMu.Lock()
				protocolOK = false
				deliveryMu.Unlock()
				break
			}
			deliveryMu.Lock()
			if _, exists := deliveries[frame.ID]; exists {
				protocolOK = false
				deliveryMu.Unlock()
				break
			}
			deliveries[frame.ID] = &delivery{}
			deliveryMu.Unlock()
			handlers.Add(1)
			go func(frame rpcFrame) {
				defer handlers.Done()
				var value any
				var callErr error
				if frame.Method == "handoff" {
					var request struct {
						Message string `json:"message"`
					}
					callErr = json.Unmarshal(frame.Args, &request)
					if callErr == nil && request.Message == "" {
						callErr = errors.New("handoff message is empty")
					}
					if callErr == nil {
						handoffMu.Lock()
						handoff = request.Message
						handoffMu.Unlock()
						value = map[string]bool{"accepted": true}
					}
				} else {
					value, callErr = r.call(bridgeCtx, frame.Method, frame.Args)
				}
				owners := foregroundOwners(value)
				reply := rpcReply{ID: frame.ID, Result: value}
				if callErr != nil {
					reply.Error = callErr.Error()
				}
				encoded, encodeErr := json.Marshal(reply)
				eligible := callErr == nil && encodeErr == nil && len(encoded) <= maxBridgeFrame
				if encodeErr != nil || len(encoded) > maxBridgeFrame {
					reply = rpcReply{ID: frame.ID, Error: "helper response exceeds protocol bounds"}
				}
				deliveryMu.Lock()
				deliveries[frame.ID].owners = owners
				deliveries[frame.ID].eligible = eligible
				deliveryMu.Unlock()
				writeMu.Lock()
				err := enc.Encode(reply)
				writeMu.Unlock()
				if err != nil {
					deliveryMu.Lock()
					deliveries[frame.ID].eligible = false
					deliveryMu.Unlock()
				}
			}(frame)
		}
		if scanner.Err() != nil {
			deliveryMu.Lock()
			protocolOK = false
			deliveryMu.Unlock()
		}
		handlers.Wait()
	}()
	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()
	var runErr error
	select {
	case runErr = <-wait:
		// Execute children are never durable; reap descendants even after a clean leader exit.
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	case <-ctx.Done():
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
		select {
		case runErr = <-wait:
		case <-time.After(r.cfg.KillGrace):
			_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
			runErr = <-wait
		}
	}
	bridgeCancel()
	_ = reqR.Close()
	_ = respW.Close()
	<-bridgeDone
	ioWG.Wait()
	deliveryMu.Lock()
	clean := runErr == nil && ctx.Err() == nil && imageErr == "" && cmd.ProcessState != nil && cmd.ProcessState.ExitCode() == 0 && protocolOK
	var restore []string
	for _, d := range deliveries {
		if !clean || !d.ack || !d.eligible {
			restore = append(restore, d.owners...)
		}
	}
	deliveryMu.Unlock()
	for _, id := range restore {
		r.restoreCompletion(id)
	}
	handoffMu.Lock()
	handoffResult := handoff
	handoffMu.Unlock()
	output := cap.result()
	imageMu.Lock()
	ims := append([]core.Image(nil), images...)
	imageMu.Unlock()
	if !clean {
		ims = nil
	}
	result := core.ExecuteResult{Output: output, Images: ims, Handoff: handoffResult != "", HandoffMessage: handoffResult}
	if cmd.ProcessState != nil {
		result.ExitCode = cmd.ProcessState.ExitCode()
	}
	if imageErr != "" {
		result.Error = imageErr
		if result.ExitCode == 0 {
			result.ExitCode = 1
		}
	}
	if ctx.Err() != nil {
		ctxErr := ctx.Err()
		if errors.Is(context.Cause(ctx), errExecuteTimedOut) {
			ctxErr = errExecuteTimedOut
		}
		result.Error = ctxErr.Error()
		if result.ExitCode == 0 {
			result.ExitCode = -1
		}
		return result, ctxErr
	}
	if runErr != nil && result.ExitCode == 0 {
		result.ExitCode = 1
	}
	return result, nil
}

type writerFunc func([]byte)

func (f writerFunc) Write(p []byte) (int, error) { f(p); return len(p), nil }

// Callback batches may contain completed subagents as nested results. Every
// accepted foreground result shares its enclosing response's clean-exit ACK.
func foregroundOwners(value any) []string {
	var ids []string
	switch v := value.(type) {
	case Inspection:
		if !v.Background && v.Status != "running" && v.ID != "" {
			ids = append(ids, v.ID)
		}
	case []Inspection:
		for _, item := range v {
			ids = append(ids, foregroundOwners(item)...)
		}
	case []any:
		for _, item := range v {
			ids = append(ids, foregroundOwners(item)...)
		}
	case map[string]any:
		if results, ok := v["results"]; ok {
			ids = append(ids, foregroundOwners(results)...)
		}
	}
	return ids
}
