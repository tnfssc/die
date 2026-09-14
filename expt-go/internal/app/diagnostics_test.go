package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestDiagnosticsBoundedMetadata(t *testing.T) {
	dir := t.TempDir()
	a, err := NewApplication(Options{StateDir: dir, CWD: dir, Offline: true})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	for i := 0; i < 110; i++ {
		_, err = a.Session.AppendCustom("provider_attempt", map[string]any{"failed": i%2 == 0, "prompt": "SECRET_PROMPT", "authorization": "SECRET_TOKEN"})
		if err != nil {
			t.Fatal(err)
		}
	}
	_, _ = a.Session.AppendCustom("child_launch", map[string]any{"result": map[string]any{"output": "SECRET_OUTPUT"}})
	leaf := a.Session.LeafID()
	out, err := a.Slash(context.Background(), "/diagnostics durable")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "SECRET") {
		t.Fatal("diagnostics leaked payload")
	}
	if leaf != a.Session.LeafID() {
		t.Fatal("diagnostics changed leaf")
	}
	var v struct {
		Records  []any `json:"records"`
		Accepted int   `json:"accepted"`
		Dropped  int   `json:"dropped"`
	}
	if err = json.Unmarshal([]byte(out), &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Records) != 100 || v.Accepted != 111 || v.Dropped != 11 {
		t.Fatalf("unexpected bounds %+v", v)
	}
}
