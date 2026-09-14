package runtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCacheRejectsSymlinkAndRepairsAssetMode(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	asset := filepath.Join(dir, "asset")
	data := []byte("samebytes")
	os.WriteFile(target, data, 0600)
	os.Symlink(target, asset)
	if err := writeVerified(asset, data, 0600); err == nil {
		t.Fatal("symlink accepted")
	}
	os.Remove(asset)
	os.WriteFile(asset, data, 0644)
	if err := writeVerified(asset, data, 0600); err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(asset)
	if st.Mode().Perm() != 0600 {
		t.Fatal(st.Mode())
	}
}
func TestCacheRejectsParentSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "elsewhere")
	os.Mkdir(target, 0700)
	link := filepath.Join(dir, "runtimes")
	os.Symlink(target, link)
	if err := privateCacheDir(link); err == nil {
		t.Fatal("parent symlink accepted")
	}
	entries, _ := os.ReadDir(target)
	if len(entries) != 0 {
		t.Fatal("wrote through symlink")
	}
}
