package session

import (
	"sync"
	"testing"
)

func TestConcurrentGoalUpdatesKeepValidAuthority(t *testing.T) {
	s, err := New(Config{StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	g := NewGoals(s)
	if _, err = g.Set(GoalSetInput{Objective: "objective", Criteria: []string{"done"}, Constraints: []string{}}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := NewGoals(s).Update(GoalUpdateInput{Status: "active", Progress: "verified milestone"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	state, err := g.Get()
	if err != nil || state == nil {
		t.Fatalf("invalid state %v %v", state, err)
	}
	if state.Revision != 51 {
		t.Fatalf("revision=%d", state.Revision)
	}
}
