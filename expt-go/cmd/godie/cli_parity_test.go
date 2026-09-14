package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godie/internal/app"
	"godie/internal/core"
	"godie/internal/session"
)

func TestApplyCLIParityExport(t *testing.T) {
	root := t.TempDir()
	sessions := filepath.Join(root, "sessions")
	cwd := filepath.Join(root, "work")
	if err := os.MkdirAll(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	s, err := session.New(session.Config{SessionFile: filepath.Join(sessions, "export-id.jsonl"), ID: "export-id", CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AppendMessage(core.Message{Role: "user", Content: "hello"}); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(root, "result.html")
	o := app.Options{StateDir: root, SessionDir: sessions, CWD: cwd, Export: "export", Messages: []string{out}}
	handled, err := applyCLIParity(&o)
	if err != nil {
		t.Fatal(err)
	}
	if !handled {
		t.Fatal("export was not handled")
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "hello") {
		t.Fatal("missing transcript")
	}
}
