package runtime

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

func testBun(t *testing.T) string {
	t.Helper()
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun unavailable")
	}
	return bun
}

func testRuntime(t *testing.T) *Runtime {
	t.Helper()
	bun, e := exec.LookPath("bun")
	if e != nil {
		t.Skip("bun unavailable")
	}
	r, e := New(Config{CWD: t.TempDir(), StateDir: t.TempDir(), BunPath: bun, KillGrace: 50 * time.Millisecond})
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}
func call(t *testing.T, r *Runtime, method string, v any) map[string]any {
	t.Helper()
	b, _ := json.Marshal(v)
	x, e := r.Call(context.Background(), method, b)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := json.Marshal(x)
	var out map[string]any
	if e = json.Unmarshal(raw, &out); e != nil {
		t.Fatal(e)
	}
	return out
}
func TestShellForegroundAndOffsets(t *testing.T) {
	r := testRuntime(t)
	x := call(t, r, "shell", map[string]any{"command": "printf 'héllo'", "waitSeconds": 2})
	if x["status"] != "completed" {
		t.Fatalf("%v", x)
	}
	id := x["id"].(string)
	page := call(t, r, "jobs.inspect", map[string]any{"id": id, "offset": 0, "limit": 2})
	if page["output"] != "h" {
		t.Fatalf("UTF-8 page split: %#v", page)
	}
	page = call(t, r, "jobs.inspect", map[string]any{"id": id, "offset": 1, "limit": 4})
	if page["output"] != "éll" {
		t.Fatalf("unexpected page: %#v", page)
	}
}
func TestExecuteTypeScriptAndDurableJob(t *testing.T) {
	r := testRuntime(t)
	result, e := r.Execute(context.Background(), `const n: number = 2; const j = await shell("sleep .1; echo durable", {waitSeconds: 0}); console.log(n, j.background, j.id)`, 5*time.Second)
	if e != nil || result.ExitCode != 0 || !strings.Contains(result.Output, "2 true task_") {
		t.Fatalf("%+v %v", result, e)
	}
	if r.Running() != 1 {
		t.Fatalf("job not durable: %d", r.Running())
	}
	deadline := time.Now().Add(2 * time.Second)
	for r.Running() != 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if r.Running() != 0 {
		t.Fatal("job did not complete")
	}
}
func TestFiftyConcurrentTasks(t *testing.T) {
	r := testRuntime(t)
	var wg sync.WaitGroup
	errs := make(chan error, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			b, _ := json.Marshal(map[string]any{"command": fmt.Sprintf("printf task-%d", i), "waitSeconds": 2})
			x, e := r.Call(context.Background(), "shell", b)
			if e != nil {
				errs <- e
				return
			}
			if x.(Inspection).Status != "completed" {
				errs <- fmt.Errorf("task %d: %#v", i, x)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	if r.Running() != 0 {
		t.Fatalf("running=%d", r.Running())
	}
	x := call(t, r, "jobs.list", map[string]any{"count": 100})
	if len(x["jobs"].([]any)) != 50 {
		t.Fatalf("jobs=%v", len(x["jobs"].([]any)))
	}
}
func TestExecuteCancellationDoesNotKillJob(t *testing.T) {
	r := testRuntime(t)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, e := r.Execute(ctx, `await shell("sleep .2", {waitSeconds: 0}); await Bun.sleep(5000)`, 0)
		done <- e
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	if e := <-done; !errors.Is(e, context.Canceled) {
		t.Fatalf("wanted context cancellation, got %v", e)
	}
	if r.Running() != 1 {
		t.Fatalf("durable job killed with execute: %d", r.Running())
	}
	time.Sleep(250 * time.Millisecond)
}

func TestExecuteSyntheticFilenameParity(t *testing.T) {
	r := testRuntime(t)
	want := filepath.Join(r.cfg.CWD, "__die_execute__.ts")
	got, err := r.Execute(context.Background(), `console.log(JSON.stringify({filename:__filename, dirname:__dirname}));`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	if !strings.Contains(got.Output, `"filename":`+strconv.Quote(want)) || !strings.Contains(got.Output, `"dirname":`+strconv.Quote(r.cfg.CWD)) {
		t.Fatalf("output=%q want filename=%q dirname=%q", got.Output, want, r.cfg.CWD)
	}
	shadowed, err := r.Execute(context.Background(), `const __filename="user-owned"; console.log(__filename)`, 5*time.Second)
	if err != nil || shadowed.ExitCode != 0 || !strings.Contains(shadowed.Output, "user-owned") {
		t.Fatalf("lexical shadowing changed: %+v %v", shadowed, err)
	}
}

func TestExecuteTimeoutDiagnosticParity(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `console.log("started"); await Bun.sleep(5000); console.log("bad")`, 50*time.Millisecond)
	if !errors.Is(err, errExecuteTimedOut) || err.Error() != "Execution timed out (SIGTERM)." {
		t.Fatalf("error=%v", err)
	}
	if got.Error != err.Error() || !strings.Contains(got.Output, "started") || strings.Contains(got.Output, "bad") {
		t.Fatalf("result=%+v", got)
	}
}

func TestShowImageInvalidHeaderDiagnosticParity(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `try { await showImage(new Uint8Array([1,2,3])) } catch (e) { console.log(e.message) }`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	want := "showImage supports PNG, JPEG, and WebP bytes; unsupported or missing image header"
	if strings.TrimSpace(got.Output) != want {
		t.Fatalf("output=%q want=%q", got.Output, want)
	}
}

func TestExecuteModulesRequireAndImage(t *testing.T) {
	r := testRuntime(t)
	if err := os.WriteFile(r.cfg.CWD+"/value.ts", []byte("export default 7"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(r.cfg.CWD+"/data.json", []byte("{\"x\":3}"), 0600); err != nil {
		t.Fatal(err)
	}
	code := `import value from "./value.ts"; const d=require("./data.json"); await showImage(Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,6,0,0,0,31,21,196,137])); console.log(value+d.x)`
	got, err := r.Execute(context.Background(), code, 5*time.Second)
	if err != nil || got.ExitCode != 0 || !strings.Contains(got.Output, "10") || len(got.Images) != 1 {
		t.Fatalf("%+v %v", got, err)
	}
}
func TestCloseCancelsExecuteWorker(t *testing.T) {
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun unavailable")
	}
	r, err := New(Config{CWD: t.TempDir(), StateDir: t.TempDir(), BunPath: bun, KillGrace: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, e := r.Execute(context.Background(), `await Bun.sleep(30000)`, 0); done <- e }()
	time.Sleep(100 * time.Millisecond)
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-done:
		if e == nil {
			t.Fatal("execute returned no shutdown error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("execute worker leaked")
	}
}

func TestEmbeddedBunStartsOffline(t *testing.T) {
	if testing.Short() {
		t.Skip("embedded runtime extraction")
	}
	r, err := New(Config{CWD: t.TempDir(), StateDir: t.TempDir(), KillGrace: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, err := r.Execute(context.Background(), `const x: number = await Promise.resolve(41); console.log(x+1)`, 5*time.Second)
	if err != nil || got.ExitCode != 0 || !strings.Contains(got.Output, "42") {
		t.Fatalf("%+v %v", got, err)
	}
}

func TestPromiseAllDispatchesFiftyHelpersConcurrently(t *testing.T) {
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun unavailable")
	}
	var active, peak int64
	r, err := New(Config{CWD: t.TempDir(), StateDir: t.TempDir(), BunPath: bun, Helper: func(ctx context.Context, method string, args json.RawMessage) (any, error) {
		n := atomic.AddInt64(&active, 1)
		for {
			old := atomic.LoadInt64(&peak)
			if n <= old || atomic.CompareAndSwapInt64(&peak, old, n) {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
		atomic.AddInt64(&active, -1)
		return map[string]any{"ok": true}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, err := r.Execute(context.Background(), `const xs=await Promise.all(Array.from({length:50},(_,i)=>subagent({prompt:String(i)}))); console.log(xs.length)`, 5*time.Second)
	if err != nil || got.ExitCode != 0 || !strings.Contains(got.Output, "50") {
		t.Fatalf("%+v %v", got, err)
	}
	if atomic.LoadInt64(&peak) < 25 {
		t.Fatalf("helper calls serialized: peak=%d", peak)
	}
}

func TestForegroundCompletionOwnershipAndCrashRestore(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `await shell("true", {waitSeconds: 2}); console.log("clean")`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	select {
	case ev := <-r.Events():
		if ev.Type == "completed" {
			t.Fatalf("foreground completion duplicated: %+v", ev)
		}
	default:
	}
	got, err = r.Execute(context.Background(), `await shell("true", {waitSeconds: 2}); process.kill(process.pid, "SIGKILL")`, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case ev := <-r.Events():
		for ev.Type != "completed" {
			ev = <-r.Events()
		}
	case <-time.After(2 * time.Second):
		t.Fatal("worker crash did not restore completion ownership")
	}
}

func TestBackgroundCompletionExactlyOnce(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `await shell("sleep .05", {waitSeconds: 0})`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	count := 0
	deadline := time.After(2 * time.Second)
	for count == 0 {
		select {
		case ev := <-r.Events():
			if ev.Type == "completed" {
				count++
			}
		case <-deadline:
			t.Fatal("missing completion")
		}
	}
	time.Sleep(50 * time.Millisecond)
	for {
		select {
		case ev := <-r.Events():
			if ev.Type == "completed" {
				count++
			}
		default:
			if count != 1 {
				t.Fatalf("completion count=%d", count)
			}
			return
		}
	}
}

func TestAgentArgvLaunchAndLifecycleSidecar(t *testing.T) {
	dir := t.TempDir()
	sessionFile := filepath.Join(dir, "owner.jsonl")
	r, err := New(Config{CWD: dir, StateDir: t.TempDir(), SessionFile: sessionFile, BunPath: testBun(t), KillGrace: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	job, err := r.Launch(context.Background(), []string{"/bin/sh", "-c", "printf child"}, LaunchOptions{ID: "reserved", Kind: "agent", CallerID: "caller-1", CloseInput: true, Agent: &AgentInfo{Type: "fast", Depth: 1, SessionFile: filepath.Join(dir, "child.jsonl"), ParentSessionFile: sessionFile}})
	if err != nil {
		t.Fatal(err)
	}
	if job.ID != "reserved" || job.CallerID != "caller-1" || job.Agent == nil {
		t.Fatalf("%+v", job)
	}
	j, _ := r.get(job.ID)
	<-j.done
	data, err := os.ReadFile(sessionFile + ".jobs.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, `"event":"spawned"`) || !strings.Contains(text, `"event":"completed"`) || strings.Contains(text, "printf child") {
		t.Fatalf("bad lifecycle: %s", text)
	}
}

func TestOriginalRuntimeSnippetDifferential(t *testing.T) {
	original, err := filepath.Abs("../../bin/die-original")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(original); err != nil {
		t.Skip("original fixture unavailable")
	}
	dir := t.TempDir()
	if err = os.WriteFile(filepath.Join(dir, "mod.ts"), []byte("export const value:number=40"), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := New(Config{CWD: dir, StateDir: t.TempDir(), BunPath: testBun(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	snippets := []string{
		`const n:number=1; console.log(n+1)`,
		`const {value}=await import("./mod.ts"); console.log(value+2)`,
		`const values=await Promise.all(Array.from({length:50},async(_,i)=>{await Bun.sleep(1);return i})); console.log(values.length,values[49])`,
	}
	for _, source := range snippets {
		cmd := exec.Command(original, "--die-internal-execute")
		cmd.Dir = dir
		cmd.Stdin = strings.NewReader(source)
		home := t.TempDir()
		cmd.Env = []string{"HOME=" + home, "XDG_CONFIG_HOME=" + home, "XDG_STATE_HOME=" + home, "PATH=" + os.Getenv("PATH")}
		want, originalErr := cmd.CombinedOutput()
		got, gotErr := r.Execute(context.Background(), source, 5*time.Second)
		if (originalErr != nil) != (gotErr != nil || got.ExitCode != 0) || strings.TrimSpace(string(want)) != strings.TrimSpace(got.Output) {
			t.Fatalf("source=%s\noriginal=%q err=%v\ngodie=%q result=%+v err=%v", source, want, originalErr, got.Output, got, gotErr)
		}
	}
}

func TestOversizedImageUsesIsolatedPhoton(t *testing.T) {
	if testing.Short() {
		t.Skip("large image codec")
	}
	dir := t.TempDir()
	img := image.NewNRGBA(image.Rect(0, 0, 1400, 1400))
	if _, err := rand.Read(img.Pix); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "noise.png")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	err = png.Encode(f, img)
	closeErr := f.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	st, _ := os.Stat(path)
	if st.Size() <= 5_000_000 {
		t.Fatalf("fixture not oversized: %d", st.Size())
	}
	r, err := New(Config{CWD: dir, StateDir: t.TempDir(), BunPath: testBun(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, err := r.Execute(context.Background(), `await showImage("noise.png"); console.log("resized")`, 20*time.Second)
	if err != nil || got.ExitCode != 0 || len(got.Images) != 1 {
		t.Fatalf("%+v %v", got, err)
	}
	if n := len(got.Images[0].Data) * 3 / 4; n > 5_000_000 {
		t.Fatalf("resized bytes=%d", n)
	}
}

func TestBoundedCompletionDeliveryDoesNotDrop(t *testing.T) {
	r := testRuntime(t)
	const total = 270
	for i := 0; i < total; i++ {
		if _, err := r.Launch(context.Background(), []string{"/bin/true"}, LaunchOptions{CloseInput: true}); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	deadline := time.After(10 * time.Second)
	for len(seen) < total {
		select {
		case ev := <-r.Events():
			if ev.Type == "completed" {
				seen[ev.Job.ID] = true
			}
		case <-deadline:
			t.Fatalf("received %d/%d completions", len(seen), total)
		}
	}
}

func TestBlockedInputDoesNotBlockStop(t *testing.T) {
	r := testRuntime(t)
	x, err := r.Call(context.Background(), "shell", mustRaw(map[string]any{"command": "sleep 30", "waitSeconds": 0, "closeInput": false}))
	if err != nil {
		t.Fatal(err)
	}
	id := x.(Inspection).ID
	writeDone := make(chan struct{})
	go func() {
		_, _ = r.Call(context.Background(), "jobs.input", mustRaw(map[string]any{"id": id, "data": strings.Repeat("x", 8<<20)}))
		close(writeDone)
	}()
	time.Sleep(30 * time.Millisecond)
	stopped := make(chan struct{})
	go func() {
		_, _ = r.Call(context.Background(), "jobs.stop", mustRaw(map[string]any{"id": id}))
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stop blocked behind stdin write")
	}
	select {
	case <-writeDone:
	case <-time.After(2 * time.Second):
		t.Fatal("stdin write did not release after stop")
	}
}

func mustRaw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

func TestExecuteOutputUnicodeBoundAndArtifactFailureNotice(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `console.log("😀".repeat(5000))`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	parts := strings.SplitN(got.Output, "\n", 2)
	if len(parts) != 2 || !strings.Contains(parts[0], "complete output:") {
		t.Fatalf("missing artifact notice: %q", got.Output[:min(len(got.Output), 200)])
	}
	if n := len([]rune(parts[1])); n != 4000 {
		t.Fatalf("preview runes=%d", n)
	}
}

func TestExecuteCleanExitKillsDescendants(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Execute(context.Background(), `const p=Bun.spawn(["sh","-c","sleep 30 </dev/null >/dev/null 2>&1 & echo $!"],{stdout:"pipe"}); console.log((await new Response(p.stdout).text()).trim()); await p.exited`, 5*time.Second)
	if err != nil || got.ExitCode != 0 {
		t.Fatalf("%+v %v", got, err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(got.Output))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for {
		err = syscall.Kill(pid, 0)
		if err != nil {
			break
		}
		if time.Now().After(deadline) {
			_ = syscall.Kill(pid, syscall.SIGKILL)
			t.Fatalf("execute descendant %d survived clean exit", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHandoffReleasesOutstandingForegroundWait(t *testing.T) {
	r := testRuntime(t)
	start := time.Now()
	got, err := r.Execute(context.Background(), `await Promise.all([shell("sleep 60",{waitSeconds:60}),handoff("continue later")])`, 5*time.Second)
	if err != nil || !got.Handoff || got.HandoffMessage != "continue later" {
		t.Fatalf("%+v %v", got, err)
	}
	if time.Since(start) > time.Second {
		t.Fatalf("handoff waited %v", time.Since(start))
	}
	if r.Running() != 1 {
		t.Fatalf("outstanding job not transferred: %d", r.Running())
	}
}

func TestRuntimeHelperStrictValidationNoLaunch(t *testing.T) {
	r := testRuntime(t)
	bad := []struct {
		method string
		args   any
	}{
		{"shell", map[string]any{}},
		{"shell", map[string]any{"command": 1}},
		{"shell", map[string]any{"command": "true", "extra": true}},
		{"shell", map[string]any{"command": "true", "waitSeconds": -1}},
		{"shell", map[string]any{"command": "true", "waitSeconds": 86401}},
		{"shell", map[string]any{"command": "true", "timeoutSeconds": 0}},
		{"shell", map[string]any{"command": "true", "timeoutSeconds": 86401}},
		{"shell", map[string]any{"command": "true", "closeInput": "true"}},
		{"shell", map[string]any{"command": "true", "waitSeconds": 0, "options": map[string]any{"waitSeconds": 1}}},
		{"jobs.list", map[string]any{"count": 1, "options": map[string]any{"count": 2}}},
		{"jobs.list", map[string]any{"cursor": -1}},
		{"jobs.list", map[string]any{"cursor": 1.5}},
		{"jobs.list", map[string]any{"count": 0}},
		{"jobs.list", map[string]any{"count": 101}},
		{"jobs.list", map[string]any{"count": "2"}},
		{"jobs.inspect", map[string]any{"id": 3}},
		{"jobs.inspect", map[string]any{"id": "missing", "offset": -1}},
		{"jobs.inspect", map[string]any{"id": "missing", "limit": 5001}},
		{"jobs.input", map[string]any{"id": "missing", "data": false}},
		{"jobs.input", map[string]any{"id": "missing", "closeInput": 1}},
		{"jobs.closeInput", map[string]any{"id": "missing", "unknown": true}},
		{"jobs.stop", map[string]any{}},
		{"jobs.snooze", map[string]any{"id": "missing"}},
		{"jobs.snooze", map[string]any{"id": "missing", "minutes": 0}},
		{"jobs.setWatch", map[string]any{"id": "missing", "enabled": "yes"}},
	}
	for _, tc := range bad {
		t.Run(tc.method+fmt.Sprint(tc.args), func(t *testing.T) {
			if _, err := r.Call(context.Background(), tc.method, mustRaw(tc.args)); err == nil {
				t.Fatal("malformed helper call succeeded")
			}
			if r.Running() != 0 || len(r.order) != 0 {
				t.Fatalf("malformed helper launched a job: running=%d jobs=%d", r.Running(), len(r.order))
			}
		})
	}
}

func TestUnknownHelperRemainsAppOwnedAndReceivesFlattenedOptions(t *testing.T) {
	var got any
	r := testRuntime(t)
	r.cfg.Helper = func(_ context.Context, _ string, args json.RawMessage) (any, error) {
		if err := json.Unmarshal(args, &got); err != nil {
			return nil, err
		}
		return true, nil
	}
	if _, err := r.Call(context.Background(), "history.search", mustRaw(map[string]any{"query": "q", "options": map[string]any{"limit": "app-validates"}})); err != nil {
		t.Fatal(err)
	}
	m, ok := got.(map[string]any)
	if !ok || m["query"] != "q" || m["limit"] != "app-validates" {
		t.Fatalf("callback args: %#v", got)
	}
	if _, err := r.Call(context.Background(), "goal.set", json.RawMessage("[1,2]")); err != nil {
		t.Fatal(err)
	}
}

func TestBoundedMiddleCommandPreview(t *testing.T) {
	command := strings.Repeat("a", 200)
	got := previewJob(Job{Command: command}).Command
	if len([]rune(got)) > 160 || !strings.Contains(got, "characters omitted") || !strings.HasPrefix(got, "a") || !strings.HasSuffix(got, "a") {
		t.Fatalf("unbounded command preview: %q", got)
	}
}

func TestOutputArtifactWriteFailureIsReported(t *testing.T) {
	path := filepath.Join(t.TempDir(), "readonly-output")
	if err := os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	c := capture{spill: f, path: path, b: []byte(strings.Repeat("x", executeInline+1))}
	c.write([]byte("more"))
	if c.err == "" {
		t.Fatal("spill write error was ignored")
	}
	if got := c.result(); !strings.Contains(got, "full output could not be saved") {
		t.Fatalf("missing failure notice: %q", got)
	}
}

func TestKnownHelperFlattensOptions(t *testing.T) {
	r := testRuntime(t)
	got, err := r.Call(context.Background(), "jobs.list", mustRaw(map[string]any{"options": map[string]any{"count": 1}}))
	if err != nil || got == nil {
		t.Fatalf("%#v %v", got, err)
	}
	if r.Running() != 0 {
		t.Fatal("list launched a job")
	}
}
