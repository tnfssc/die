package app

import "testing"

func TestSessionIDMaterializesExactHeader(t *testing.T) {
	dir := t.TempDir()
	id := "12345678-1234-1234-1234-123456789abc"
	o, e := PrepareCLIOptions(Options{StateDir: dir, CWD: dir, SessionID: id, Offline: true})
	if e != nil {
		t.Fatal(e)
	}
	a, e := NewApplication(o)
	if e != nil {
		t.Fatal(e)
	}
	defer a.Close()
	if a.Session.ID() != id {
		t.Fatalf("ID %q != %q", a.Session.ID(), id)
	}
}
