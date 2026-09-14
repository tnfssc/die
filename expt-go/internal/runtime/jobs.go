package runtime

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const maxCapture = 1_000_000
const maxInspect = 5_000

type managedJob struct {
	mu      sync.Mutex
	stdinMu sync.Mutex
	Job
	cmd                *exec.Cmd
	stdin              io.WriteCloser
	output             []byte
	done               chan struct{}
	cancel             context.CancelFunc
	watch              bool
	snooze             time.Time
	lastNotice         time.Time
	killOnce           sync.Once
	notifyOnComplete   bool
	completionNotified bool
	captureWG          sync.WaitGroup
}
type Runtime struct {
	cfg                 Config
	mu                  sync.RWMutex
	jobs                map[string]*managedJob
	order               []string
	events              chan Event
	closed              chan struct{}
	closeOnce           sync.Once
	bunPath, runnerPath string
	wg                  sync.WaitGroup
	execMu              sync.Mutex
	launchMu            sync.Mutex
	execNext            uint64
	execCancels         map[uint64]context.CancelFunc
	execWG              sync.WaitGroup
	closing             bool
}

func New(cfg Config) (*Runtime, error) {
	if cfg.CWD == "" {
		var e error
		cfg.CWD, e = os.Getwd()
		if e != nil {
			return nil, e
		}
	}
	if cfg.StateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("resolve default state directory: %w", err)
		}
		cfg.StateDir = home + "/.godie"
	}
	if cfg.KillGrace <= 0 {
		cfg.KillGrace = 5 * time.Second
	}
	if cfg.ShutdownTimeout <= 0 {
		cfg.ShutdownTimeout = 10 * time.Second
	}
	if err := os.MkdirAll(cfg.StateDir, 0700); err != nil {
		return nil, err
	}
	bun, runner, err := prepareRuntime(cfg)
	if err != nil {
		return nil, err
	}
	r := &Runtime{cfg: cfg, jobs: map[string]*managedJob{}, events: make(chan Event, 256), closed: make(chan struct{}), execCancels: make(map[uint64]context.CancelFunc), bunPath: bun, runnerPath: runner}
	r.wg.Add(1)
	go r.attentionLoop()
	return r, nil
}
func (r *Runtime) Events() <-chan Event { return r.events }
func (r *Runtime) Running() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	n := 0
	for _, j := range r.jobs {
		j.mu.Lock()
		if j.Status == "running" {
			n++
		}
		j.mu.Unlock()
	}
	return n
}
func id() string { b := make([]byte, 4); _, _ = rand.Read(b); return "task_" + hex.EncodeToString(b) }
func (r *Runtime) emit(e Event) {
	e.Job = previewJob(e.Job)
	if e.Type == "completed" || e.Type == "attention" || e.Type == "completion" {
		// Completion ownership cannot be discarded. The bounded channel applies
		// backpressure until the app consumes it or shutdown releases producers.
		select {
		case r.events <- e:
		case <-r.closed:
		}
		return
	}
	// Lifecycle UI hints are coalescible; durable truth lives in jobs + sidecar.
	select {
	case r.events <- e:
	default:
	}
}
func (r *Runtime) spawn(command string, closeInput bool, timeout time.Duration) (*managedJob, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	return r.launch([]string{shell, "-lc", command}, LaunchOptions{Kind: "command", DisplayCommand: command, CloseInput: closeInput, Timeout: timeout})
}

// Launch starts argv directly (never through a shell). It is the integration API
// for agents whose session identity must be persisted before process creation.
func (r *Runtime) Launch(ctx context.Context, argv []string, opts LaunchOptions) (Job, error) {
	_ = ctx // caller cancellation must not terminate a successfully launched durable job
	j, err := r.launch(argv, opts)
	if err != nil {
		return Job{}, err
	}
	r.background(j)
	return previewJob(j.snapshot()), nil
}

// LaunchForeground launches argv and applies the same exact-once foreground
// ownership protocol as shell. A zero wait returns a durable background job.
func (r *Runtime) LaunchForeground(ctx context.Context, argv []string, opts LaunchOptions, wait time.Duration) (Inspection, error) {
	j, err := r.launch(argv, opts)
	if err != nil {
		return Inspection{}, err
	}
	return previewInspection(r.foreground(ctx, j, wait)), nil
}

func (r *Runtime) launch(argv []string, opts LaunchOptions) (*managedJob, error) {
	r.launchMu.Lock()
	defer r.launchMu.Unlock()
	select {
	case <-r.closed:
		return nil, errors.New("runtime is closed")
	default:
	}
	if len(argv) == 0 || strings.TrimSpace(argv[0]) == "" {
		return nil, errors.New("launch requires nonempty argv")
	}
	kind := opts.Kind
	if kind == "" {
		kind = "command"
	}
	if kind != "command" && kind != "agent" {
		return nil, errors.New("launch kind must be command or agent")
	}
	if kind == "agent" && (opts.Agent == nil || opts.Agent.SessionFile == "") {
		return nil, errors.New("agent launch requires child session metadata")
	}
	jobID := opts.ID
	if jobID == "" {
		jobID = id()
	}
	r.mu.RLock()
	duplicate := r.jobs[jobID] != nil
	r.mu.RUnlock()
	if duplicate {
		return nil, errors.New("duplicate job ID")
	}
	cwd := opts.CWD
	if cwd == "" {
		cwd = r.cfg.CWD
	}
	display := opts.DisplayCommand
	if display == "" {
		display = strings.Join(argv, " ")
	}
	cmdCtx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(cmdCtx, argv[0], argv[1:]...)
	cmd.Dir = cwd
	if opts.Env != nil {
		cmd.Env = append([]string(nil), os.Environ()...)
		for k, v := range opts.Env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	now := time.Now()
	job := Job{ID: jobID, Kind: kind, Command: display, CallerID: opts.CallerID, CWD: cwd, Status: "running", StartedAt: now.Format(time.RFC3339Nano), LastActivityAt: now.Format(time.RFC3339Nano), StdinOpen: !opts.CloseInput}
	if opts.Agent != nil {
		a := *opts.Agent
		if a.Phase == "" {
			a.Phase = "starting"
		}
		job.Agent = &a
		job.SessionFile = a.SessionFile
	}
	j := &managedJob{Job: job, cmd: cmd, stdin: stdin, done: make(chan struct{}), cancel: cancel, watch: true}
	if err = cmd.Start(); err != nil {
		cancel()
		return nil, err
	}
	j.PID = cmd.Process.Pid
	if opts.CloseInput {
		_ = stdin.Close()
	}
	r.mu.Lock()
	if r.jobs[jobID] != nil {
		r.mu.Unlock()
		r.stop(j, "duplicate-id")
		return nil, errors.New("duplicate job ID")
	}
	r.jobs[jobID] = j
	r.order = append(r.order, jobID)
	r.mu.Unlock()
	r.lifecycle("spawned", j.snapshot())
	r.emit(Event{Type: "spawned", Job: j.snapshot()})
	j.captureWG.Add(2)
	r.wg.Add(3)
	go r.capture(j, stdout)
	go r.capture(j, stderr)
	go r.reap(j, opts.Timeout)
	return j, nil
}

func (r *Runtime) capture(j *managedJob, rd io.Reader) {
	defer r.wg.Done()
	defer j.captureWG.Done()
	b := make([]byte, 32*1024)
	for {
		n, e := rd.Read(b)
		if n > 0 {
			j.mu.Lock()
			j.OutputEnd += int64(n)
			j.output = append(j.output, b[:n]...)
			if len(j.output) > maxCapture {
				d := len(j.output) - maxCapture
				j.output = append([]byte(nil), j.output[d:]...)
				j.BaseOffset += int64(d)
			}
			j.LastActivityAt = time.Now().Format(time.RFC3339Nano)
			snap := j.Job
			j.mu.Unlock()
			r.emit(Event{Type: "updated", Job: snap})
		}
		if e != nil {
			return
		}
	}
}
func (r *Runtime) reap(j *managedJob, timeout time.Duration) {
	defer r.wg.Done()
	defer j.cancel()
	var timer *time.Timer
	if timeout > 0 {
		timer = time.AfterFunc(timeout, func() { r.stop(j, "timeout") })
	}
	e := j.cmd.Wait()
	j.captureWG.Wait()
	if timer != nil {
		timer.Stop()
	}
	j.mu.Lock()
	if j.Status == "running" {
		if j.Termination != nil {
			j.Status = "killed"
		} else if e == nil {
			j.Status = "completed"
		} else {
			j.Status = "failed"
		}
		if ee := new(exec.ExitError); errors.As(e, &ee) {
			j.ExitCode = ee.ExitCode()
			if ws, ok := ee.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
				j.Signal = ws.Signal().String()
			}
		} else if e != nil {
			j.ExitCode = -1
		}
	}
	j.CompletedAt = time.Now().Format(time.RFC3339Nano)
	j.StdinOpen = false
	if j.Agent != nil {
		j.Agent.Phase = j.Status
	}
	snap := j.Job
	notify := j.notifyOnComplete && !j.completionNotified
	if notify {
		j.completionNotified = true
	}
	j.mu.Unlock()
	r.lifecycle("completed", snap)
	close(j.done)
	if notify {
		r.emit(Event{Type: "completed", Job: snap})
	}
}
func (r *Runtime) stop(j *managedJob, cause string) {
	j.killOnce.Do(func() {
		j.mu.Lock()
		if j.Status != "running" {
			j.mu.Unlock()
			return
		}
		j.Termination = &Termination{Cause: cause, RequestedAt: time.Now().Format(time.RFC3339Nano)}
		j.TimedOut = cause == "timeout"
		pid := j.PID
		snap := j.Job
		j.mu.Unlock()
		r.lifecycle("stopping", snap)
		r.emit(Event{Type: "stopping", Job: snap})
		if pid > 0 {
			_ = syscall.Kill(-pid, syscall.SIGTERM)
			time.AfterFunc(r.cfg.KillGrace, func() {
				j.mu.Lock()
				run := j.Status == "running"
				j.mu.Unlock()
				if run {
					_ = syscall.Kill(-pid, syscall.SIGKILL)
				}
			})
		}
	})
}
func (j *managedJob) snapshot() Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	v := j.Job
	v.WatchEnabled = j.watch
	return v
}
func (r *Runtime) get(s string) (*managedJob, error) {
	r.mu.RLock()
	j := r.jobs[s]
	r.mu.RUnlock()
	if j == nil {
		return nil, fmt.Errorf("unknown job: %s", s)
	}
	return j, nil
}
func boundedMiddle(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	marker := "…"
	for {
		retained := max(2, limit-len([]rune(marker)))
		next := fmt.Sprintf("…[%d characters omitted]…", len(runes)-retained)
		if next == marker {
			break
		}
		marker = next
	}
	retained := max(2, limit-len([]rune(marker)))
	head := (retained + 1) / 2
	tail := retained - head
	return string(runes[:head]) + marker + string(runes[len(runes)-tail:])
}
func previewJob(job Job) Job {
	job.Command = boundedMiddle(job.Command, 160)
	return job
}
func previewInspection(value Inspection) Inspection {
	value.Job = previewJob(value.Job)
	return value
}

func inspect(j *managedJob, off int64, limit int) Inspection {
	j.mu.Lock()
	defer j.mu.Unlock()
	if limit < 1 {
		limit = 1
	}
	if limit > maxInspect {
		limit = maxInspect
	}
	requested := off
	if off < j.BaseOffset {
		off = j.BaseOffset
	}
	if off > j.OutputEnd {
		off = j.OutputEnd
	}
	start := int(off - j.BaseOffset)
	end := start + limit
	if end > len(j.output) {
		end = len(j.output)
	}
	for end < len(j.output) && end > start && (j.output[end]&0xc0) == 0x80 {
		end--
	}
	if end == start && end < len(j.output) {
		for end < len(j.output) && (end == start || (j.output[end]&0xc0) == 0x80) {
			end++
		}
	}
	next := j.BaseOffset + int64(end)
	v := j.Job
	v.WatchEnabled = j.watch
	done := time.Now()
	if v.CompletedAt != "" {
		done, _ = time.Parse(time.RFC3339Nano, v.CompletedAt)
	}
	beg, _ := time.Parse(time.RFC3339Nano, v.StartedAt)
	return Inspection{Job: v, Output: string(j.output[start:end]), RequestedOffset: requested, NextOffset: next, OutputLost: requested < j.BaseOffset, HasMore: next < j.OutputEnd, ElapsedMS: max(0, done.Sub(beg).Milliseconds())}
}
func raw(m callArgs, k string) (json.RawMessage, error) {
	v, ok := m[k]
	if !ok {
		return nil, fmt.Errorf("missing %s", k)
	}
	return v, nil
}
func str(m callArgs, k string) (string, error) {
	v, e := raw(m, k)
	if e != nil {
		return "", e
	}
	var value string
	if e = json.Unmarshal(v, &value); e != nil {
		return "", fmt.Errorf("%s must be a string", k)
	}
	return value, nil
}
func strict(m callArgs, allowed []string, required ...string) error {
	known := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		known[key] = true
	}
	for key := range m {
		if !known[key] {
			return fmt.Errorf("unknown key: %s", key)
		}
	}
	for _, key := range required {
		if _, ok := m[key]; !ok {
			return fmt.Errorf("missing %s", key)
		}
	}
	return nil
}
func optionalNumber(m callArgs, key string, fallback, low, high float64, integer bool) (float64, error) {
	v, ok := m[key]
	if !ok {
		return fallback, nil
	}
	var n float64
	if json.Unmarshal(v, &n) != nil || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, fmt.Errorf("%s must be a number", key)
	}
	if n < low || n > high || (integer && math.Trunc(n) != n) {
		return 0, fmt.Errorf("%s is out of range", key)
	}
	return n, nil
}
func optionalBool(m callArgs, key string, fallback bool) (bool, error) {
	v, ok := m[key]
	if !ok {
		return fallback, nil
	}
	var b bool
	if json.Unmarshal(v, &b) != nil {
		return false, fmt.Errorf("%s must be a boolean", key)
	}
	return b, nil
}
func flattenArgs(args json.RawMessage) (json.RawMessage, error) {
	if len(args) == 0 {
		return json.RawMessage("{}"), nil
	}
	var value any
	if err := json.Unmarshal(args, &value); err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return args, nil
	}
	options, exists := object["options"]
	if !exists {
		return args, nil
	}
	optionMap, ok := options.(map[string]any)
	if !ok {
		return nil, errors.New("options must be an object")
	}
	delete(object, "options")
	for key, v := range optionMap {
		if _, duplicate := object[key]; duplicate {
			return nil, errors.New("Duplicate job option")
		}
		object[key] = v
	}
	return json.Marshal(object)
}
func runtimeMethod(method string) bool {
	switch method {
	case "shell", "jobs.list", "jobs.inspect", "jobs.input", "jobs.closeInput", "jobs.stop", "jobs.snooze", "jobs.setWatch":
		return true
	default:
		return false
	}
}
func (r *Runtime) call(ctx context.Context, method string, args json.RawMessage) (any, error) {
	flat, err := flattenArgs(args)
	if err != nil {
		return nil, err
	}
	if !runtimeMethod(method) {
		if r.cfg.Helper == nil {
			return nil, fmt.Errorf("unknown runtime method: %s", method)
		}
		return r.cfg.Helper(ctx, method, flat)
	}
	var m callArgs
	if err = json.Unmarshal(flat, &m); err != nil || m == nil {
		return nil, errors.New("job arguments must be an object")
	}
	switch method {
	case "shell":
		if err = strict(m, []string{"command", "waitSeconds", "timeoutSeconds", "closeInput"}, "command"); err != nil {
			return nil, err
		}
		c, e := str(m, "command")
		if e != nil {
			return nil, e
		}
		if strings.TrimSpace(c) == "" {
			return nil, errors.New("shell requires a nonempty command")
		}
		wait, e := optionalNumber(m, "waitSeconds", 3, 0, 86400, false)
		if e != nil {
			return nil, e
		}
		tout, e := optionalNumber(m, "timeoutSeconds", 0, .1, 86400, false)
		if e != nil {
			return nil, e
		}
		closeInput, e := optionalBool(m, "closeInput", true)
		if e != nil {
			return nil, e
		}
		j, e := r.spawn(c, closeInput, time.Duration(tout*float64(time.Second)))
		if e != nil {
			return nil, e
		}
		return previewInspection(r.foreground(ctx, j, time.Duration(wait*float64(time.Second)))), nil
	case "jobs.list":
		if err = strict(m, []string{"cursor", "count"}); err != nil {
			return nil, err
		}
		cursorN, e := optionalNumber(m, "cursor", 0, 0, math.MaxFloat64, true)
		if e != nil {
			return nil, e
		}
		countN, e := optionalNumber(m, "count", 20, 1, 100, true)
		if e != nil {
			return nil, e
		}
		count := int(countN)
		r.mu.RLock()
		ids := append([]string(nil), r.order...)
		r.mu.RUnlock()
		cursor := len(ids)
		if cursorN <= float64(len(ids)) {
			cursor = int(cursorN)
		}
		end := min(len(ids), cursor+count)
		out := make([]Job, 0, end-cursor)
		for _, x := range ids[cursor:end] {
			if j, _ := r.get(x); j != nil {
				out = append(out, previewJob(j.snapshot()))
			}
		}
		v := map[string]any{"jobs": out, "total": len(ids)}
		if end < len(ids) {
			v["nextCursor"] = end
		}
		return v, nil
	case "jobs.inspect":
		if err = strict(m, []string{"id", "offset", "limit"}, "id"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		offset, e := optionalNumber(m, "offset", 0, 0, math.MaxFloat64, true)
		if e != nil {
			return nil, e
		}
		limit, e := optionalNumber(m, "limit", maxInspect, 1, maxInspect, true)
		if e != nil {
			return nil, e
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		if _, supplied := m["offset"]; !supplied {
			offset = float64(j.snapshot().BaseOffset)
		}
		var requestedOffset int64
		if offset >= float64(math.MaxInt64) {
			requestedOffset = math.MaxInt64
		} else {
			requestedOffset = int64(offset)
		}
		return previewInspection(inspect(j, requestedOffset, int(limit))), nil
	case "jobs.input":
		if err = strict(m, []string{"id", "data", "closeInput"}, "id"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		var data string
		_, has := m["data"]
		if has {
			if e = json.Unmarshal(m["data"], &data); e != nil {
				return nil, errors.New("data must be a string")
			}
		}
		closeIt, e := optionalBool(m, "closeInput", false)
		if e != nil {
			return nil, e
		}
		if !has && !closeIt {
			return nil, errors.New("provide data or closeInput: true")
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		j.mu.Lock()
		running := j.Status == "running"
		j.mu.Unlock()
		if !running {
			return nil, errors.New("job is not running")
		}
		j.stdinMu.Lock()
		if has {
			_, e = j.stdin.Write([]byte(data))
		}
		if closeIt {
			if closeErr := j.stdin.Close(); e == nil {
				e = closeErr
			}
		}
		j.stdinMu.Unlock()
		j.mu.Lock()
		if closeIt {
			j.StdinOpen = false
		}
		j.LastActivityAt = time.Now().Format(time.RFC3339Nano)
		j.mu.Unlock()
		return previewJob(j.snapshot()), e
	case "jobs.closeInput":
		if err = strict(m, []string{"id"}, "id"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		j.stdinMu.Lock()
		e = j.stdin.Close()
		j.stdinMu.Unlock()
		j.mu.Lock()
		j.StdinOpen = false
		j.mu.Unlock()
		return previewJob(j.snapshot()), e
	case "jobs.stop":
		if err = strict(m, []string{"id"}, "id"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		r.stop(j, "user-stop")
		return previewJob(j.snapshot()), nil
	case "jobs.snooze":
		if err = strict(m, []string{"id", "minutes"}, "id", "minutes"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		mins, e := optionalNumber(m, "minutes", 0, math.SmallestNonzeroFloat64, 55, false)
		if e != nil {
			return nil, e
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		j.mu.Lock()
		j.snooze = time.Now().Add(time.Duration(mins * float64(time.Minute)))
		j.watch = true
		j.mu.Unlock()
		v := j.snapshot()
		return map[string]any{"id": v.ID, "status": v.Status, "watchEnabled": true, "snoozedMinutes": mins}, nil
	case "jobs.setWatch":
		if err = strict(m, []string{"id", "enabled"}, "id", "enabled"); err != nil {
			return nil, err
		}
		x, e := str(m, "id")
		if e != nil {
			return nil, e
		}
		enabled, e := optionalBool(m, "enabled", false)
		if e != nil {
			return nil, e
		}
		j, e := r.get(x)
		if e != nil {
			return nil, e
		}
		j.mu.Lock()
		j.watch = enabled
		j.mu.Unlock()
		return previewJob(j.snapshot()), nil
	}
	panic("unreachable")
}
func (r *Runtime) background(j *managedJob) {
	j.mu.Lock()
	j.notifyOnComplete = true
	notify := j.Status != "running" && !j.completionNotified
	if notify {
		j.completionNotified = true
	}
	snap := j.Job
	j.mu.Unlock()
	if notify {
		r.emit(Event{Type: "completed", Job: snap})
	}
}

func (r *Runtime) foreground(ctx context.Context, j *managedJob, wait time.Duration) Inspection {
	if wait > 0 {
		t := time.NewTimer(wait)
		defer t.Stop()
		select {
		case <-j.done:
			return inspect(j, max(j.snapshot().BaseOffset, j.snapshot().OutputEnd-maxInspect), maxInspect)
		case <-t.C:
		case <-ctx.Done():
		}
	}
	// Notification ownership transfers before returning a background result.
	j.mu.Lock()
	j.notifyOnComplete = true
	completed := j.Status != "running"
	notify := completed && !j.completionNotified
	if notify {
		j.completionNotified = true
	}
	j.mu.Unlock()
	v := inspect(j, j.snapshot().BaseOffset, maxInspect)
	v.Background = true
	if notify {
		r.emit(Event{Type: "completed", Job: v.Job})
	}
	return v
}

// restoreCompletion returns a foreground result's notification ownership to Go.
// It is idempotent and is used when a worker did not ACK and cleanly exit.
func (r *Runtime) restoreCompletion(id string) {
	j, err := r.get(id)
	if err != nil {
		return
	}
	j.mu.Lock()
	j.notifyOnComplete = true
	notify := j.Status != "running" && !j.completionNotified
	if notify {
		j.completionNotified = true
	}
	snap := j.Job
	j.mu.Unlock()
	if notify {
		r.emit(Event{Type: "completed", Job: snap})
	}
}

func (r *Runtime) attentionLoop() {
	defer r.wg.Done()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case now := <-t.C:
			r.mu.RLock()
			a := make([]*managedJob, 0, len(r.jobs))
			for _, j := range r.jobs {
				a = append(a, j)
			}
			r.mu.RUnlock()
			for _, j := range a {
				j.mu.Lock()
				last, _ := time.Parse(time.RFC3339Nano, j.LastActivityAt)
				due := j.Status == "running" && j.watch && now.After(j.snooze) && ((j.lastNotice.IsZero() && now.Sub(last) >= 5*time.Minute) || (!j.lastNotice.IsZero() && now.Sub(j.lastNotice) >= 10*time.Minute))
				if due {
					j.lastNotice = now
					v := j.Job
					j.mu.Unlock()
					r.emit(Event{Type: "attention", Job: v})
				} else {
					j.mu.Unlock()
				}
			}
		case <-r.closed:
			return
		}
	}
}
func (r *Runtime) Close() error {
	r.closeOnce.Do(func() {
		close(r.closed)
		r.execMu.Lock()
		r.closing = true
		for _, cancel := range r.execCancels {
			cancel()
		}
		r.execMu.Unlock()
		r.mu.RLock()
		a := make([]*managedJob, 0, len(r.jobs))
		for _, j := range r.jobs {
			a = append(a, j)
		}
		r.mu.RUnlock()
		for _, j := range a {
			r.stop(j, "session-shutdown")
		}
		done := make(chan struct{})
		go func() { r.wg.Wait(); r.execWG.Wait(); close(done) }()
		finished := false
		select {
		case <-done:
			finished = true
		case <-time.After(r.cfg.ShutdownTimeout):
			for _, j := range a {
				if j.PID > 0 {
					_ = syscall.Kill(-j.PID, syscall.SIGKILL)
				}
			}
		}
		// Do not close underneath execute cleanup after a configured short
		// shutdown deadline. The closed signal still releases event producers.
		if finished {
			close(r.events)
		}
	})
	return nil
}

var _ = bytes.MinRead
var _ = sort.Strings
var _ = strconv.Itoa
