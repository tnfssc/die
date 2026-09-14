package tui

import "testing"

func TestInitialPromptSubmitsAndClearsDraft(t *testing.T) {
	m := New(Config{InitialPrompt: "initial request"})
	if m.initialPrompt != "initial request" {
		t.Fatal("initial prompt lost")
	}
	_, cmd := m.Update(initialPromptMsg(m.initialPrompt))
	if cmd == nil || m.Draft() != "" || len(m.History()) != 1 || m.History()[0] != "initial request" {
		t.Fatalf("prompt not submitted: draft=%q history=%v", m.Draft(), m.History())
	}
}
