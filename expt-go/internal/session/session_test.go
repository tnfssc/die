package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"godie/internal/core"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixtureConfig(t *testing.T, name string) Config {
	t.Helper()
	n := 0
	return Config{SessionFile: filepath.Join(t.TempDir(), name+".jsonl"), CWD: "/fixture", ID: name, Now: func() time.Time { return time.Date(2026, 1, 2, 3, 4, n, 0, time.UTC) }, NewID: func(prefix string) string { n++; return prefix + "_" + string(rune('a'+n)) }}
}
func TestSessionBranchResumeRawAndExclusiveWriter(t *testing.T) {
	c := fixtureConfig(t, "tree")
	s, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	native := json.RawMessage("{\"response\":{\"id\":\"raw-1\"}}")
	a, e := s.AppendMessageWithUsage(core.Message{Role: "user", Content: "one", Native: native, Provider: "fixture"}, &core.Usage{Input: 7, Output: 3, Cost: .25})
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.AppendMessage(core.Message{Role: "assistant", Content: "old branch"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = Open(Config{SessionFile: c.SessionFile}); e == nil || !strings.Contains(e.Error(), "writer") {
		t.Fatalf("wanted writer exclusion, got %v", e)
	}
	if e = s.Resume(a.ID); e != nil {
		t.Fatal(e)
	}
	ce, e := s.AppendMessage(core.Message{Role: "assistant", Content: "new branch"})
	if e != nil {
		t.Fatal(e)
	}
	if ce.ParentID == nil || *ce.ParentID != a.ID {
		t.Fatalf("parent=%v", ce.ParentID)
	}
	branch, e := s.Branch()
	if e != nil || len(branch) != 2 || branch[1].ID != ce.ID {
		t.Fatalf("branch %#v %v", branch, e)
	}
	if b.ID == ce.ID {
		t.Fatal("ids not unique")
	}
	if e = s.Close(); e != nil {
		t.Fatal(e)
	}
	opened, e := Open(Config{SessionFile: c.SessionFile, Now: c.Now, NewID: c.NewID})
	if e != nil {
		t.Fatal(e)
	}
	defer opened.Close()
	msgs, e := opened.Messages()
	if e != nil || len(msgs) != 2 {
		t.Fatalf("messages %#v %v", msgs, e)
	}
	usage, err := opened.Usage()
	if err != nil || usage.Input != 7 || usage.Cost != .25 {
		t.Fatalf("usage %#v %v", usage, err)
	}
	if !bytes.Equal(msgs[0].Native, native) {
		t.Fatalf("native changed: %s", msgs[0].Native)
	}
}
func TestTornTailRecoveryAndLegacyNeverMutated(t *testing.T) {
	c := fixtureConfig(t, "torn")
	s, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.AppendMessage(core.Message{Role: "user", Content: "safe"}); e != nil {
		t.Fatal(e)
	}
	s.Close()
	f, e := os.OpenFile(c.SessionFile, os.O_APPEND|os.O_WRONLY, 0)
	if e != nil {
		t.Fatal(e)
	}
	f.WriteString("{\"type\":\"message\",\"id\":\"torn")
	f.Close()
	opened, e := Open(Config{SessionFile: c.SessionFile, Now: c.Now, NewID: c.NewID})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = opened.AppendMessage(core.Message{Role: "assistant", Content: "after"}); e != nil {
		t.Fatal(e)
	}
	opened.Close()
	data, e := os.ReadFile(c.SessionFile)
	if e != nil {
		t.Fatal(e)
	}
	for _, line := range bytes.Split(bytes.TrimSpace(data), []byte{'\n'}) {
		if !json.Valid(line) {
			t.Fatalf("invalid repaired line: %s", line)
		}
	}
	legacy := filepath.Join(t.TempDir(), "pi.jsonl")
	fixture := []byte("{\"type\":\"session\",\"version\":2,\"id\":\"pi-one\",\"timestamp\":\"x\",\"cwd\":\"/tmp\"}\n{\"type\":\"message\",\"id\":\"pi-entry\",\"parentId\":null,\"timestamp\":\"x\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"legacy text\"}]}}\n")
	if e = os.WriteFile(legacy, fixture, 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = Open(Config{SessionFile: legacy}); !errors.Is(e, ErrLegacyReadOnly) {
		t.Fatalf("wanted legacy error, got %v", e)
	}
	after, _ := os.ReadFile(legacy)
	if !bytes.Equal(after, fixture) {
		t.Fatal("legacy session was mutated")
	}
	reader, e := OpenReadOnly(legacy)
	if e != nil {
		t.Fatal(e)
	}
	legacyBranch, e := reader.Branch()
	if e != nil || len(legacyBranch) != 1 || legacyBranch[0].Message.Content != "legacy text" {
		t.Fatalf("legacy fixture %#v %v", legacyBranch, e)
	}
}
func TestHistoryExclusionsPagingAndCrossSessionConsent(t *testing.T) {
	c := fixtureConfig(t, "history")
	s, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	first, _ := s.AppendMessage(core.Message{Role: "user", Content: "Needle first text"})
	s.AppendMessage(core.Message{Role: "assistant", Content: "Needle second text"})
	secret, _ := s.AppendMessage(core.Message{Role: "toolResult", Content: "needle secret"})
	s.AppendCustom("die-manual-shake", map[string]any{"toolResultEntryIds": []string{secret.ID}})
	h := NewHistory(s)
	raw := json.RawMessage("{\"query\":\"needle\",\"limit\":1,\"excerptChars\":40}")
	v, e := h.Handle(context.Background(), "history.search", raw)
	if e != nil {
		t.Fatal(e)
	}
	page := v.(HistorySearchResult)
	if len(page.Matches) != 1 || page.NextCursor == "" || strings.Contains(page.Matches[0].Excerpt, "secret") {
		t.Fatalf("bad matches %#v", page)
	}
	readArgs, _ := json.Marshal(map[string]any{"ref": page.Matches[0].Ref, "maxChars": 4})
	rv, e := h.Handle(context.Background(), "history.read", readArgs)
	if e != nil {
		t.Fatal(e)
	}
	read := rv.(HistoryReadResult)
	if read.Text != "Need" || read.NextCursor == "" {
		t.Fatalf("bad read %#v", read)
	}
	if err := s.Resume(first.ID); err != nil {
		t.Fatal(err)
	}
	pageArgs, _ := json.Marshal(map[string]any{"query": "needle", "limit": 1, "excerptChars": 40, "cursor": page.NextCursor})
	if _, err := h.Handle(context.Background(), "history.search", pageArgs); err == nil || !strings.Contains(err.Error(), "cursor does not match") {
		t.Fatalf("branch cursor error=%v", err)
	}
	otherCfg := fixtureConfig(t, "other")
	other, e := New(otherCfg)
	if e != nil {
		t.Fatal(e)
	}
	other.AppendMessage(core.Message{Role: "user", Content: "cross-only needle"})
	other.Close()
	q, _ := json.Marshal(map[string]any{"query": "cross-only", "sessionFile": otherCfg.SessionFile})
	if _, e = h.Handle(context.Background(), "history.search", q); e == nil || !strings.Contains(e.Error(), "allowCrossSession") {
		t.Fatalf("consent error=%v", e)
	}
	q, _ = json.Marshal(map[string]any{"query": "cross-only", "sessionFile": otherCfg.SessionFile, "allowCrossSession": true})
	v, e = h.Handle(context.Background(), "history.search", q)
	if e != nil || len(v.(HistorySearchResult).Matches) != 1 {
		t.Fatalf("cross result=%#v err=%v", v, e)
	}
}
func TestGoalsAreDurableBranchStateAndHelpers(t *testing.T) {
	c := fixtureConfig(t, "goals")
	s, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	g := NewGoals(s)
	goal, e := g.Set(GoalSetInput{Objective: "ship it", Criteria: []string{"tests pass"}, Constraints: []string{"offline"}})
	if e != nil {
		t.Fatal(e)
	}
	activeLeaf := s.LeafID()
	done, e := g.Update(GoalUpdateInput{Status: "completed", Evidence: "fixture passed"})
	if e != nil || done.Revision <= goal.Revision {
		t.Fatalf("update %#v %v", done, e)
	}
	if e = s.Resume(activeLeaf); e != nil {
		t.Fatal(e)
	}
	restored, e := g.Get()
	if e != nil || restored == nil || restored.Status != "active" {
		t.Fatalf("branch goal %#v %v", restored, e)
	}
	if _, e = g.Handle(context.Background(), "goal.update", json.RawMessage("{\"status\":\"waiting\",\"pendingJobIds\":[\"task_x\"]}")); e == nil || !strings.Contains(e.Error(), "runtime-managed") {
		t.Fatalf("helper waiting=%v", e)
	}
	helper := NewHelper(s)
	if v, err := helper(context.Background(), "goal.get", json.RawMessage("{}")); err != nil || v.(*GoalState).ID != restored.ID {
		t.Fatalf("helper route %#v %v", v, err)
	}
	text, e := g.Slash("status")
	if e != nil || !strings.Contains(text, "ship it") {
		t.Fatalf("slash %q %v", text, e)
	}
}

func TestStateDirAndChildMetadata(t *testing.T) {
	dir := t.TempDir()
	n := 0
	s, err := New(Config{StateDir: dir, ID: "child-session", CWD: "/isolated", Metadata: Metadata{Role: "worker", Type: "normal", Depth: 2, TaskID: "task_fixture", ParentSessionID: "parent-id", ParentSessionFile: "/state/parent.jsonl", RootSessionID: "root-id"}, Now: func() time.Time { return time.Unix(1, 0) }, NewID: func(prefix string) string { n++; return prefix + "_fixture" + string(rune('0'+n)) }})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if !strings.HasPrefix(s.File(), filepath.Join(dir, "sessions")) || s.Header().ParentSession != "/state/parent.jsonl" || s.Header().Metadata.Depth != 2 {
		t.Fatalf("header/path %#v %s", s.Header(), s.File())
	}
	branch, err := s.Branch()
	if err != nil || len(branch) != 1 || branch[0].CustomType != "die-agent" {
		t.Fatalf("identity entry %#v %v", branch, err)
	}
	var identity Metadata
	if err = json.Unmarshal(branch[0].Data, &identity); err != nil || identity.Role != "worker" || identity.Depth != 2 || identity.ParentSessionID != "parent-id" {
		t.Fatalf("identity %#v %v", identity, err)
	}
}

func TestWriterLockReleasedWhenProcessIsKilled(t *testing.T) {
	if os.Getenv("GODIE_LOCK_HELPER") == "1" {
		s, err := Open(Config{SessionFile: os.Getenv("GODIE_LOCK_FILE")})
		if err != nil {
			os.Exit(2)
		}
		defer s.Close()
		_, _ = os.Stdout.WriteString("locked\n")
		time.Sleep(time.Hour)
	}
	c := fixtureConfig(t, "crash-lock")
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestWriterLockReleasedWhenProcessIsKilled$")
	cmd.Env = append(os.Environ(), "GODIE_LOCK_HELPER=1", "GODIE_LOCK_FILE="+c.SessionFile)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	ready := make([]byte, len("locked\n"))
	if _, err = io.ReadFull(stdout, ready); err != nil {
		t.Fatal(err)
	}
	if _, err = Open(Config{SessionFile: c.SessionFile}); err == nil {
		t.Fatal("second writer acquired live lock")
	}
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	reopened, err := Open(Config{SessionFile: c.SessionFile})
	if err != nil {
		t.Fatalf("reopen after process death: %v", err)
	}
	_ = reopened.Close()
}

func TestResumeSelectionSurvivesRestartWithoutChangingBranch(t *testing.T) {
	c := fixtureConfig(t, "durable-branch")
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := s.AppendMessage(core.Message{Role: "user", Content: "root"})
	_, _ = s.AppendMessage(core.Message{Role: "assistant", Content: "abandoned"})
	if err = s.Resume(first.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(Config{SessionFile: c.SessionFile, Now: c.Now, NewID: c.NewID})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	branch, err := s.Branch()
	if err != nil || len(branch) != 1 || branch[0].ID != first.ID {
		t.Fatalf("restored branch %#v %v", branch, err)
	}
	next, err := s.AppendMessage(core.Message{Role: "assistant", Content: "chosen"})
	if err != nil || next.ParentID == nil || *next.ParentID != first.ID {
		t.Fatalf("append parent %#v %v", next, err)
	}
}

func TestHiddenMessagesStayInProviderProjectionButNotHistory(t *testing.T) {
	c := fixtureConfig(t, "hidden")
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, _ = s.AppendMessage(core.Message{Role: "user", Content: "visible needle"})
	_, _ = s.AppendMessage(core.Message{Role: "user", Content: "hidden needle", Hidden: true})
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(Config{SessionFile: c.SessionFile, Now: c.Now, NewID: c.NewID})
	if err != nil {
		t.Fatal(err)
	}
	messages, err := s.Messages()
	if err != nil || len(messages) != 2 || !messages[1].Hidden || messages[1].Content != "hidden needle" {
		t.Fatalf("provider messages %#v %v", messages, err)
	}
	items, _, _, err := makeItems(s, "current", ptr(s.LeafID()))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].text != "visible needle" {
		t.Fatalf("history items %#v", items)
	}
}

func ptr(v string) *string { return &v }

func TestProviderAttemptAndDescendantCombinedUsage(t *testing.T) {
	dir := t.TempDir()
	rootPath := filepath.Join(dir, "root.jsonl")
	root, err := New(Config{SessionFile: rootPath, ID: "root"})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = root.AppendCustom("provider_attempt", map[string]any{"usage": core.Usage{Input: 3, Cost: .3}})
	childPath := filepath.Join(dir, "child.jsonl")
	child, err := New(Config{SessionFile: childPath, ID: "child", Metadata: Metadata{Role: "worker", Depth: 1, ParentSessionFile: rootPath}})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = child.AppendCustom("provider_attempt", map[string]any{"usage": core.Usage{Output: 4, Cost: .4}})
	grandPath := filepath.Join(dir, "grand.jsonl")
	grand, err := New(Config{SessionFile: grandPath, ID: "grand"})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = grand.AppendCustom("provider_attempt", map[string]any{"usage": core.Usage{CacheRead: 5, Cost: .5}})
	_, _ = child.AppendCustom("child_launch", map[string]any{"sessionFile": grandPath})
	// A cycle and duplicate routes must not count either child twice.
	_, _ = grand.AppendCustom("child_launch", map[string]any{"sessionFile": childPath})
	_, _ = root.AppendCustom("child_launch", map[string]any{"sessionFile": childPath})
	_ = child.Close()
	_ = grand.Close()
	total, err := root.CombinedUsage()
	if err != nil {
		t.Fatal(err)
	}
	if total.Input != 3 || total.Output != 4 || total.CacheRead != 5 || total.Cost != 1.2 {
		t.Fatalf("combined %#v", total)
	}
	_ = root.Close()
}

func TestRuntimeGoalWaitingAndReconciliation(t *testing.T) {
	c := fixtureConfig(t, "goal-runtime")
	s, err := New(c)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	g := NewGoals(s)
	_, _ = g.Set(GoalSetInput{Objective: "finish", Criteria: []string{"done"}, Constraints: []string{}})
	waiting, err := g.Waiting([]string{"task_a", "task_b"})
	if err != nil || waiting.Status != "waiting" {
		t.Fatalf("waiting %#v %v", waiting, err)
	}
	r, err := g.ReconcileRunning(map[string]bool{"task_a": true, "task_b": false})
	if err != nil || !r.Continue || r.Goal.Status != "active" {
		t.Fatalf("reconcile %#v %v", r, err)
	}
	_, _ = g.Waiting([]string{"task_gone"})
	r, err = g.ReconcileRunning(map[string]bool{})
	if err != nil || r.Continue || r.Goal.Status != "paused" || !strings.Contains(r.Goal.PauseReason, "task_gone") {
		t.Fatalf("unavailable %#v %v", r, err)
	}
}

func storedGoalFixture() map[string]any {
	return map[string]any{
		"id": "goal_fixture", "revision": 1, "objective": "ship",
		"criteria": []any{"tests pass"}, "constraints": []any{}, "status": "active",
		"createdAt": "2026-01-02T03:04:05Z", "updatedAt": "2026-01-02T03:04:05Z",
	}
}

func cloneJSONMap(t *testing.T, value map[string]any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err = json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestGoalRestoreFailClosedSchema(t *testing.T) {
	cases := map[string]func(map[string]any, map[string]any){
		"missing objective":          func(goal, _ map[string]any) { delete(goal, "objective") },
		"nonsensical id":             func(goal, _ map[string]any) { goal["id"] = []any{} },
		"empty criteria":             func(goal, _ map[string]any) { goal["criteria"] = []any{} },
		"missing constraints":        func(goal, _ map[string]any) { delete(goal, "constraints") },
		"null constraints":           func(goal, _ map[string]any) { goal["constraints"] = nil },
		"unsafe revision":            func(goal, _ map[string]any) { goal["revision"] = 9007199254740992.0 },
		"completed without evidence": func(goal, _ map[string]any) { goal["status"] = "completed" },
		"blocked without blocker":    func(goal, _ map[string]any) { goal["status"] = "blocked" },
		"waiting without ids":        func(goal, _ map[string]any) { goal["status"] = "waiting" },
		"waiting with empty ids":     func(goal, _ map[string]any) { goal["status"] = "waiting"; goal["pendingJobIds"] = []any{} },
		"paused without reason":      func(goal, _ map[string]any) { goal["status"] = "paused" },
		"too many progress items":    func(goal, _ map[string]any) { goal["progress"] = []any{"1", "2", "3", "4", "5", "6", "7", "8", "9"} },
		"oversize progress":          func(goal, _ map[string]any) { goal["progress"] = []any{strings.Repeat("😀", 251)} },
		"future record version":      func(_, record map[string]any) { record["version"] = 2 },
		"missing operation at":       func(_, record map[string]any) { delete(record, "at") },
		"null operation at":          func(_, record map[string]any) { record["at"] = nil },
	}
	for name, corrupt := range cases {
		t.Run(name, func(t *testing.T) {
			c := fixtureConfig(t, "corrupt")
			s, err := New(c)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			g := NewGoals(s)
			if _, err = g.Set(GoalSetInput{Objective: "old", Criteria: []string{"valid"}, Constraints: []string{}}); err != nil {
				t.Fatal(err)
			}
			goal := storedGoalFixture()
			record := map[string]any{"version": 1, "operation": "set", "goal": goal, "at": "2026-01-02T03:04:05Z"}
			corrupt(goal, record)
			if _, err = s.AppendCustom(goalEntryType, record); err != nil {
				t.Fatal(err)
			}
			got, err := g.Get()
			if err != nil || got != nil {
				t.Fatalf("corrupt authority restored %#v, err=%v", got, err)
			}
		})
	}
}

func TestGoalRestoreUTF16BoundariesAndExtensions(t *testing.T) {
	newStore := func(t *testing.T, goal map[string]any, at any) *GoalState {
		t.Helper()
		s, err := New(fixtureConfig(t, "unicode"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = s.Close() })
		record := map[string]any{"version": 1, "operation": "set", "goal": goal, "at": at, "futureExtension": map[string]any{"any": 42}}
		goal["futureExtension"] = []any{false, 7}
		if _, err = s.AppendCustom(goalEntryType, record); err != nil {
			t.Fatal(err)
		}
		got, err := NewGoals(s).Get()
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	goal := storedGoalFixture()
	goal["objective"] = strings.Repeat("😀", 2000)
	if got := newStore(t, goal, ""); got == nil {
		t.Fatal("4000 UTF-16-unit field and empty string at should restore")
	}
	goal = storedGoalFixture()
	goal["objective"] = strings.Repeat("😀", 2001)
	if got := newStore(t, goal, "now"); got != nil {
		t.Fatal("4002 UTF-16-unit field restored")
	}

	goal = storedGoalFixture()
	goal["objective"] = strings.Repeat("😀", 2000)
	goal["criteria"] = []any{strings.Repeat("😀", 2000)}
	goal["constraints"] = []any{strings.Repeat("😀", 2000)}
	if got := newStore(t, goal, "now"); got == nil {
		t.Fatal("12000 UTF-16-unit aggregate should restore")
	}
	goal = cloneJSONMap(t, goal)
	goal["constraints"] = append(goal["constraints"].([]any), "x")
	if got := newStore(t, goal, "now"); got != nil {
		t.Fatal("12001 UTF-16-unit aggregate restored")
	}

	goal = storedGoalFixture()
	goal["progress"] = []any{strings.Repeat("😀", 250)}
	if got := newStore(t, goal, "now"); got == nil {
		t.Fatal("500 UTF-16-unit progress should restore")
	}
}

func TestGoalHelperStrictJSONArraysAndOptionalValues(t *testing.T) {
	s, err := New(fixtureConfig(t, "goal-helper-strict"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	g := NewGoals(s)
	for _, raw := range []string{
		`{"objective":"ship","criteria":["done"]}`,
		`{"objective":"ship","criteria":["done"],"constraints":null}`,
	} {
		if _, err = g.Handle(context.Background(), "goal.set", json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	if _, err = g.Handle(context.Background(), "goal.set", json.RawMessage(`{"objective":"ship","criteria":["done"],"constraints":[],"extension":42}`)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`{"status":"active","progress":null}`,
		`{"status":"active","progress":""}`,
		`{"status":"paused","reason":null}`,
		`{"status":"paused","reason":""}`,
	} {
		if _, err = g.Handle(context.Background(), "goal.update", json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	got, err := g.Handle(context.Background(), "goal.update", json.RawMessage(`{"status":"paused"}`))
	if err != nil || got.(*GoalState).PauseReason != "Paused" {
		t.Fatalf("paused default %#v %v", got, err)
	}
}
