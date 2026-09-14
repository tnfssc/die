package app

import "testing"

func TestParseCLIParityFlagsAndFiles(t *testing.T) {
	o, err := ParseOptions([]string{"--fork", "abc", "--session-id=fork.1", "@one.txt", "--", "@two.txt", "ask"})
	if err != nil {
		t.Fatal(err)
	}
	if o.Fork != "abc" || o.SessionID != "fork.1" {
		t.Fatalf("flags: %#v", o)
	}
	if len(o.FileArgs) != 2 || o.FileArgs[0] != "one.txt" || o.FileArgs[1] != "two.txt" {
		t.Fatalf("files: %#v", o.FileArgs)
	}
	if len(o.Messages) != 1 || o.Messages[0] != "ask" {
		t.Fatalf("messages: %#v", o.Messages)
	}
}
func TestParseCLIParityConflicts(t *testing.T) {
	for _, args := range [][]string{{"--fork", "x", "--continue"}, {"--session-id", "x", "--session", "y"}, {"--mode", "rpc", "@x"}} {
		if _, err := ParseOptions(args); err == nil {
			t.Errorf("accepted %#v", args)
		}
	}
}
