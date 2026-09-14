package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractionRecoversStaleLockFile(t *testing.T) {
	dir := t.TempDir()
	runner, err := runtimeAssets.ReadFile("assets/runner.js")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(runner)
	root := filepath.Join(dir, "runtimes", "bun-1.4.1", hex.EncodeToString(sum[:8]))
	if err = os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, ".extract.lock"), []byte("stale"), 0600); err != nil {
		t.Fatal(err)
	}
	bun, _, err := prepareRuntime(Config{StateDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := verifyFile(bun, pinnedBunSHA256); err != nil || !ok {
		t.Fatalf("verify %v %v", ok, err)
	}
}
