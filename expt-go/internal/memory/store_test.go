package memory_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godie/internal/memory"
)

func store(t *testing.T) (*memory.Store, string) {
	t.Helper()
	root := t.TempDir()
	s, err := memory.New(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s, root
}
func pending(t *testing.T, root, name, content string) string {
	t.Helper()
	dir := filepath.Join(root, ".agents", "notes", ".pending")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func hash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func TestSnapshotPendingStableDirectMarkdown(t *testing.T) {
	s, root := store(t)
	pending(t, root, "z.md", "last\n")
	pending(t, root, "a.md", "first\n")
	pending(t, root, "ignore.txt", "no")
	if err := os.MkdirAll(filepath.Join(root, ".agents", "notes", ".pending", "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".agents", "notes", ".pending", "nested", "hidden.md"), []byte("no"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := s.SnapshotPending()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Path != ".agents/notes/.pending/a.md" || got[1].Path != ".agents/notes/.pending/z.md" {
		t.Fatalf("unexpected snapshot: %#v", got)
	}
	if got[0].Content != "first\n" || got[0].SHA256 != hash("first\n") {
		t.Fatalf("wrong bytes/hash: %#v", got[0])
	}
}

func TestSnapshotLimitsAndSymlink(t *testing.T) {
	t.Run("count", func(t *testing.T) {
		s, root := store(t)
		for i := 0; i <= memory.MaxPendingFiles; i++ {
			pending(t, root, fmtName(i), "")
		}
		if _, err := s.SnapshotPending(); err == nil || !strings.Contains(err.Error(), "file limit") {
			t.Fatalf("wanted file limit, got %v", err)
		}
	})
	t.Run("file", func(t *testing.T) {
		s, root := store(t)
		path := pending(t, root, "large.md", "")
		if err := os.Truncate(path, memory.MaxPendingFileBytes+1); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SnapshotPending(); err == nil || !strings.Contains(err.Error(), "byte read limit") {
			t.Fatalf("wanted byte limit, got %v", err)
		}
	})
	t.Run("aggregate", func(t *testing.T) {
		s, root := store(t)
		for i := 0; i < 9; i++ {
			path := pending(t, root, fmtName(i), "")
			if err := os.Truncate(path, memory.MaxPendingFileBytes); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.SnapshotPending(); err == nil || !strings.Contains(err.Error(), "aggregate limit") {
			t.Fatalf("wanted aggregate limit, got %v", err)
		}
	})
	t.Run("symlink", func(t *testing.T) {
		s, root := store(t)
		outside := filepath.Join(root, "outside.md")
		os.WriteFile(outside, []byte("secret"), 0600)
		dir := filepath.Join(root, ".agents", "notes", ".pending")
		os.MkdirAll(dir, 0700)
		if err := os.Symlink(outside, filepath.Join(dir, "linked.md")); err != nil {
			t.Skip(err)
		}
		if _, err := s.SnapshotPending(); err == nil || !strings.Contains(err.Error(), "symlink") {
			t.Fatalf("wanted symlink rejection, got %v", err)
		}
	})
}
func fmtName(i int) string { return fmt.Sprintf("%03d.md", i) }

func TestConsumeMarkersLeaveChangedSourceRetryable(t *testing.T) {
	s, root := store(t)
	pending(t, root, "same.md", "same")
	changed := pending(t, root, "changed.md", "before")
	snap, err := s.SnapshotPending()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(changed, []byte("after"), 0600); err != nil {
		t.Fatal(err)
	}
	pending(t, root, "new.md", "new")
	result, err := s.Consume(snap, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Consumed) != 2 || len(result.Retained) != 0 {
		t.Fatalf("unexpected consume: %#v", result)
	}
	again, err := s.SnapshotPending()
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 2 || again[0].Content != "after" || again[1].Content != "new" {
		t.Fatalf("changed/new content was lost: %#v", again)
	}
	if got, err := os.ReadFile(changed); err != nil || string(got) != "after" {
		t.Fatalf("source was mutated: %q %v", got, err)
	}
}

func TestConsumeInvalidatedRetainsEverything(t *testing.T) {
	s, root := store(t)
	pending(t, root, "a.md", "retry")
	snap, _ := s.SnapshotPending()
	result, err := s.Consume(snap, func() bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Consumed) != 0 || len(result.Retained) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	again, _ := s.SnapshotPending()
	if len(again) != 1 || again[0].Content != "retry" {
		t.Fatalf("snapshot consumed: %#v", again)
	}
}

func TestSaveExpectedHashAndReceipt(t *testing.T) {
	s, root := store(t)
	dir := filepath.Join(root, ".agents", "notes", "decisions")
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "index.md"), []byte("user content"), 0600)
	if _, err := s.Save("decisions", "replacement", nil); !errors.Is(err, memory.ErrChanged) {
		t.Fatalf("wanted changed, got %v", err)
	}
	current, err := s.Read("decisions")
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := s.Save("decisions", "replacement", &current.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if !s.VerifySave(receipt) {
		t.Fatal("receipt did not verify")
	}
	if err = os.WriteFile(filepath.Join(root, receipt.Path), []byte("changed after save"), 0600); err != nil {
		t.Fatal(err)
	}
	if s.VerifySave(receipt) {
		t.Fatal("changed receipt verified")
	}
	if _, err = s.Save("../outside", "bad", nil); err == nil {
		t.Fatal("traversal accepted")
	}
}

func writeWorkerReceipt(t *testing.T, p *memory.Preparation, files map[string]string) {
	t.Helper()
	entries := make([]map[string]string, 0, len(files))
	for path, content := range files {
		full := filepath.Join(filepath.Dir(p.ReceiptPath), filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		entries = append(entries, map[string]string{"path": path, "sha256": hash(content)})
	}
	body, _ := json.Marshal(map[string]any{"files": entries})
	if err := os.WriteFile(p.ReceiptPath, body, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestExplicitPrepareAndVerifiedCommit(t *testing.T) {
	var events []memory.Event
	s, root := store(t)
	s, _ = memory.New(root, func(e memory.Event) { events = append(events, e) })
	source := pending(t, root, "fact.md", "fact")
	if _, err := s.Prepare(memory.PrepareRequest{Root: false, Profile: "fast", Constraints: "none"}); !errors.Is(err, memory.ErrRootOnly) {
		t.Fatalf("wanted root-only, got %v", err)
	}
	if _, err := s.Prepare(memory.PrepareRequest{Root: true, Profile: "other", Constraints: "none"}); !errors.Is(err, memory.ErrInvalidProfile) {
		t.Fatalf("wanted profile error, got %v", err)
	}
	if _, err := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast"}); !errors.Is(err, memory.ErrConstraintsRequired) {
		t.Fatalf("wanted constraints error, got %v", err)
	}
	p, err := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "do not commit"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(p.Prompt, "do not commit") || !strings.Contains(p.Prompt, ".agents/notes/.pending/fact.md") {
		t.Fatalf("incomplete prompt: %s", p.Prompt)
	}
	// A producer replacement is not deleted or hidden by consuming the old immutable snapshot.
	os.WriteFile(source, []byte("new fact"), 0600)
	writeWorkerReceipt(t, p, map[string]string{"index.md": "# Memory\n"})
	result, err := s.Commit(p, memory.Completion{Root: true, Completed: true, ExitCode: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Consumed) != 1 {
		t.Fatalf("not consumed: %#v", result)
	}
	retry, _ := s.SnapshotPending()
	if len(retry) != 1 || retry[0].Content != "new fact" {
		t.Fatalf("replacement lost: %#v", retry)
	}
	if _, err := os.Stat(p.ReceiptPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("receipt not removed: %v", err)
	}
	foundCommit := false
	for _, event := range events {
		if event.Operation == "commit" {
			foundCommit = true
		}
	}
	if !foundCommit {
		t.Fatalf("missing API log: %#v", events)
	}
}

func TestCommitFailureAndChangedSavedContentRetainInputs(t *testing.T) {
	t.Run("worker failure", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "normal", Constraints: "none"})
		result, err := s.Commit(p, memory.Completion{Root: true, Completed: false, ExitCode: 1})
		if !errors.Is(err, memory.ErrWorkerFailed) || len(result.Retained) != 1 {
			t.Fatalf("unsafe failure: %#v %v", result, err)
		}
		again, _ := s.SnapshotPending()
		if len(again) != 1 {
			t.Fatal("failure consumed input")
		}
	})
	t.Run("saved bytes changed", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "none"})
		writeWorkerReceipt(t, p, map[string]string{"index.md": "good"})
		os.WriteFile(filepath.Join(root, ".agents", "notes", "index.md"), []byte("changed"), 0600)
		result, err := s.Commit(p, memory.Completion{Root: true, Completed: true})
		if !errors.Is(err, memory.ErrInvalidReceipt) || len(result.Retained) != 1 {
			t.Fatalf("changed content consumed: %#v %v", result, err)
		}
		again, _ := s.SnapshotPending()
		if len(again) != 1 {
			t.Fatal("invalid receipt consumed input")
		}
	})
	t.Run("missing root index", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "none"})
		writeWorkerReceipt(t, p, map[string]string{"topic/note.md": "note"})
		result, err := s.Commit(p, memory.Completion{Root: true, Completed: true})
		if !errors.Is(err, memory.ErrInvalidReceipt) || len(result.Retained) != 1 {
			t.Fatalf("missing index consumed: %#v %v", result, err)
		}
	})
}

func TestCommitReceiptBoundsAndPaths(t *testing.T) {
	t.Run("receipt bytes", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "none"})
		f, err := os.Create(p.ReceiptPath)
		if err != nil {
			t.Fatal(err)
		}
		if err = f.Truncate(memory.MaxReceiptBytes + 1); err != nil {
			t.Fatal(err)
		}
		f.Close()
		result, err := s.Commit(p, memory.Completion{Root: true, Completed: true})
		if !errors.Is(err, memory.ErrInvalidReceipt) || len(result.Retained) != 1 {
			t.Fatalf("oversized receipt accepted: %#v %v", result, err)
		}
	})
	t.Run("escaping path", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "none"})
		body, _ := json.Marshal(map[string]any{"files": []map[string]string{{"path": "../outside.md", "sha256": hash("x")}, {"path": "index.md", "sha256": hash("x")}}})
		os.WriteFile(p.ReceiptPath, body, 0600)
		result, err := s.Commit(p, memory.Completion{Root: true, Completed: true})
		if !errors.Is(err, memory.ErrInvalidReceipt) || len(result.Retained) != 1 {
			t.Fatalf("escaping path accepted: %#v %v", result, err)
		}
	})
	t.Run("root rechecked", func(t *testing.T) {
		s, root := store(t)
		pending(t, root, "a.md", "a")
		p, _ := s.Prepare(memory.PrepareRequest{Root: true, Profile: "fast", Constraints: "none"})
		writeWorkerReceipt(t, p, map[string]string{"index.md": "memory"})
		result, err := s.Commit(p, memory.Completion{Root: false, Completed: true})
		if !errors.Is(err, memory.ErrRootOnly) || len(result.Retained) != 1 {
			t.Fatalf("child commit accepted: %#v %v", result, err)
		}
		again, _ := s.SnapshotPending()
		if len(again) != 1 {
			t.Fatal("non-root commit consumed input")
		}
	})
}
