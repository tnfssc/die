package app

import (
	"path/filepath"
	"testing"

	"godie/internal/core"
	"godie/internal/session"
)

func navigationTestApplication(t *testing.T) *Application {
	t.Helper()
	root := t.TempDir()
	a, err := NewApplication(Options{StateDir: root, SessionDir: filepath.Join(root, "sessions"), CWD: root, Offline: true, Provider: "openai", Model: "test-model", Thinking: "medium", Mode: "text"})
	if err != nil {
		t.Fatal(err)
	}
	a.Interactive = true
	return a
}

func TestPrepareNavigationNewResumeLifecycle(t *testing.T) {
	a := navigationTestApplication(t)
	oldPath, oldID := a.Session.File(), a.Session.ID()
	req, handled, err := PrepareNavigation(a, "/new")
	if err != nil || !handled {
		t.Fatalf("new: handled=%v err=%v", handled, err)
	}
	if req.Options.Session != "" || req.Options.Provider != a.Options.Provider || req.Options.Model != a.Options.Model {
		t.Fatalf("new options: %#v", req.Options)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	fresh, err := NewApplication(req.Options)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Session.ID() == oldID || fresh.Session.File() == oldPath {
		t.Fatal("/new reused the old session")
	}
	fresh.Interactive = true
	resume, handled, err := PrepareNavigation(fresh, "/resume "+oldPath)
	if err != nil || !handled {
		t.Fatalf("resume: handled=%v err=%v", handled, err)
	}
	if err = fresh.Close(); err != nil {
		t.Fatal(err)
	}
	previous, err := NewApplication(resume.Options)
	if err != nil {
		t.Fatal(err)
	}
	defer previous.Close()
	if previous.Session.ID() != oldID {
		t.Fatalf("resumed %q, want %q", previous.Session.ID(), oldID)
	}
}

func TestPrepareNavigationForkAndCloneBranches(t *testing.T) {
	a := navigationTestApplication(t)
	first, err := a.Session.AppendMessage(core.Message{Role: "user", Content: "one"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Session.AppendMessage(core.Message{Role: "assistant", Content: "two"}); err != nil {
		t.Fatal(err)
	}

	fork, handled, err := PrepareNavigation(a, "/fork "+first.ID)
	if err != nil || !handled {
		t.Fatalf("fork: %v %v", handled, err)
	}
	clone, handled, err := PrepareNavigation(a, "/clone")
	if err != nil || !handled {
		t.Fatalf("clone: %v %v", handled, err)
	}
	for path, want := range map[string]int{fork.Options.Session: 1, clone.Options.Session: 2} {
		r, err := session.OpenReadOnly(path)
		if err != nil {
			t.Fatal(err)
		}
		entries, err := r.Branch()
		if err != nil {
			t.Fatal(err)
		}
		messages := 0
		for _, e := range entries {
			if e.Message != nil {
				messages++
			}
		}
		if messages != want {
			t.Fatalf("%s has %d messages, want %d", path, messages, want)
		}
		if r.Header().ParentSession != a.Session.File() {
			t.Fatalf("missing parent on %s", path)
		}
	}
	a.Close()
}

func TestPrepareNavigationRestrictionsAndCatalogFallback(t *testing.T) {
	a := navigationTestApplication(t)
	defer a.Close()
	if _, handled, err := PrepareNavigation(a, "/resume"); err != nil || handled {
		t.Fatalf("catalog fallback: %v %v", handled, err)
	}
	a.Options.Depth = 1
	if _, handled, err := PrepareNavigation(a, "/new"); !handled || err == nil {
		t.Fatalf("child navigation: %v %v", handled, err)
	}
}
