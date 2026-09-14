package runtime

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestConcurrentFastExecuteDrainsOutput(t *testing.T) {
	dir := t.TempDir()
	r, e := New(Config{StateDir: dir, CWD: dir, SessionFile: dir + "/session.jsonl"})
	if e != nil {
		t.Fatal(e)
	}
	defer r.Close()
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			marker := fmt.Sprintf("FAST_DRAIN_%d", i)
			result, e := r.Execute(context.Background(), fmt.Sprintf("console.log(%q)", marker), 30*time.Second)
			if e != nil || result.ExitCode != 0 || !strings.Contains(result.Output, marker) {
				t.Errorf("marker %s lost: %+v %v", marker, result, e)
			}
		}(i)
	}
	wg.Wait()
}
