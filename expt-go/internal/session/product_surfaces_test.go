package session

import (
	"godie/internal/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProductTreeCatalogAndExports(t *testing.T) {
	root := t.TempDir()
	n := 0
	s, err := New(Config{StateDir: root, CWD: "/work", ID: "s1", Now: func() time.Time { return time.Unix(int64(n+1), 0).UTC() }, NewID: func(p string) string { n++; return p + string(rune('a'+n)) }})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	first, err := s.AppendMessage(core.Message{Role: "user", Content: "hello <world>"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.AppendMessage(core.Message{Role: "assistant", Content: "answer"})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Resume(first.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.AppendMessage(core.Message{Role: "user", Content: "other branch"})
	if err != nil {
		t.Fatal(err)
	}
	tree, err := s.Tree()
	if err != nil {
		t.Fatal(err)
	}
	if len(tree) != 3 || tree[1].OnActiveBranch || !tree[2].ActiveLeaf {
		t.Fatalf("unexpected tree: %#v", tree)
	}
	cat, err := Catalog(filepath.Join(root, "sessions"), "/work")
	if err != nil || len(cat) != 1 || cat[0].ID != "s1" {
		t.Fatalf("catalog: %#v %v", cat, err)
	}
	jp := filepath.Join(root, "copy.jsonl")
	if _, err = s.ExportJSONL(jp); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(jp); !strings.Contains(string(b), `"id":"s1"`) {
		t.Fatal("missing header")
	}
	hp := filepath.Join(root, "copy.html")
	if _, err = s.ExportHTML(hp); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(hp)
	if strings.Contains(string(b), "<world>") || !strings.Contains(string(b), "&lt;world&gt;") {
		t.Fatal("HTML was not escaped")
	}
}
