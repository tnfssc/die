package runtime

import (
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	goruntime "runtime"
	"syscall"
	"time"
)

//go:embed assets/runner.js assets/bun-linux-amd64.gz assets/photon/*
var runtimeAssets embed.FS

const pinnedBunSHA256 = "69293d3be4f0d6d624ca8581af4574435fa39209ab67e89eb03912866f3e14cb"

func prepareRuntime(cfg Config) (string, string, error) {
	runnerBytes, e := runtimeAssets.ReadFile("assets/runner.js")
	if e != nil {
		return "", "", e
	}
	sum := sha256.Sum256(runnerBytes)
	root := filepath.Join(cfg.StateDir, "runtimes", "bun-1.4.1", hex.EncodeToString(sum[:8]))
	if e = os.MkdirAll(cfg.StateDir, 0700); e != nil {
		return "", "", e
	}
	if st, err := os.Lstat(cfg.StateDir); err != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return "", "", errors.New("runtime state directory must be a real directory")
	}
	for _, dir := range []string{filepath.Join(cfg.StateDir, "runtimes"), filepath.Join(cfg.StateDir, "runtimes", "bun-1.4.1"), root} {
		if e = privateCacheDir(dir); e != nil {
			return "", "", e
		}
	}
	runner := filepath.Join(root, "runner.js")
	if e = writeVerified(runner, runnerBytes, 0600); e != nil {
		return "", "", e
	}
	photonDir := filepath.Join(root, "photon")
	if e = privateCacheDir(photonDir); e != nil {
		return "", "", e
	}
	for _, name := range []string{"photon_rs.js", "photon_rs_bg.js", "photon_rs_bg.wasm", "LICENSE.md"} {
		data, readErr := runtimeAssets.ReadFile("assets/photon/" + name)
		if readErr != nil {
			return "", "", readErr
		}
		if e = writeVerified(filepath.Join(photonDir, name), data, 0600); e != nil {
			return "", "", e
		}
	}
	if cfg.BunPath != "" {
		p, e := filepath.Abs(cfg.BunPath)
		if e != nil {
			return "", "", e
		}
		if e = executable(p); e != nil {
			return "", "", e
		}
		return p, runner, nil
	}
	if goruntime.GOOS != "linux" || goruntime.GOARCH != "amd64" {
		return "", "", errors.New("embedded Bun supports linux/amd64 only; configure BunPath")
	}
	bun := filepath.Join(root, "bun")
	if ok, _ := verifyFile(bun, pinnedBunSHA256); ok {
		return bun, runner, nil
	}
	lock := filepath.Join(root, ".extract.lock")
	lf, e := os.OpenFile(lock, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if e != nil {
		return "", "", fmt.Errorf("runtime extraction lock: %w", e)
	}
	defer lf.Close()
	locked := false
	for n := 0; n < 200; n++ {
		e = syscall.Flock(int(lf.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if e == nil {
			locked = true
			break
		}
		if e != syscall.EWOULDBLOCK && e != syscall.EAGAIN {
			return "", "", fmt.Errorf("runtime extraction lock: %w", e)
		}
		if ok, _ := verifyFile(bun, pinnedBunSHA256); ok {
			return bun, runner, nil
		}
		sleepExtraction()
	}
	if !locked {
		return "", "", errors.New("runtime extraction lock timed out")
	}
	defer syscall.Flock(int(lf.Fd()), syscall.LOCK_UN)
	// Keep the lock inode in place: removing it would allow two independent locks.
	// Kernel ownership disappears on process death, so interrupted extraction retries.
	if ok, _ := verifyFile(bun, pinnedBunSHA256); ok {
		return bun, runner, nil
	}
	f, e := runtimeAssets.Open("assets/bun-linux-amd64.gz")
	if e != nil {
		return "", "", e
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		return "", "", e
	}
	defer gz.Close()
	tmp, e := os.CreateTemp(root, ".bun-*")
	if e != nil {
		return "", "", e
	}
	name := tmp.Name()
	defer os.Remove(name)
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(gz, 150_000_001))
	if e == nil && n > 150_000_000 {
		e = errors.New("embedded Bun exceeds extraction limit")
	}
	if e == nil && hex.EncodeToString(h.Sum(nil)) != pinnedBunSHA256 {
		e = errors.New("embedded Bun hash mismatch")
	}
	if e == nil {
		e = tmp.Sync()
	}
	if x := tmp.Close(); e == nil {
		e = x
	}
	if e == nil {
		e = os.Chmod(name, 0700)
	}
	if e == nil {
		e = os.Rename(name, bun)
	}
	if e != nil {
		return "", "", e
	}
	return bun, runner, nil
}
func sleepExtraction() { time.Sleep(25 * time.Millisecond) }
func executable(p string) error {
	s, e := os.Stat(p)
	if e != nil {
		return e
	}
	if !s.Mode().IsRegular() || s.Mode().Perm()&0111 == 0 {
		return errors.New("BunPath is not an executable regular file")
	}
	return nil
}
func verifyFile(p, want string) (bool, error) {
	f, e := os.OpenFile(p, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if e != nil {
		return false, e
	}
	defer f.Close()
	s, e := f.Stat()
	if e != nil || !s.Mode().IsRegular() || s.Mode().Perm()&0111 == 0 {
		return false, e
	}
	h := sha256.New()
	if _, e = io.Copy(h, f); e != nil {
		return false, e
	}
	if hex.EncodeToString(h.Sum(nil)) != want {
		return false, nil
	}
	if st, ok := s.Sys().(*syscall.Stat_t); !ok || st.Uid != uint32(os.Geteuid()) {
		return false, errors.New("runtime cache has foreign ownership")
	}
	if s.Mode().Perm() != 0700 {
		if e = f.Chmod(0700); e != nil {
			return false, e
		}
	}
	return true, nil
}
func writeVerified(path string, data []byte, mode os.FileMode) error {
	if st, e := os.Lstat(path); e == nil {
		if !st.Mode().IsRegular() {
			return errors.New("runtime asset must be a regular non-symlink file")
		}
		f, e := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
		if e != nil {
			return e
		}
		info, e := f.Stat()
		if e != nil {
			f.Close()
			return e
		}
		if own, ok := info.Sys().(*syscall.Stat_t); !ok || own.Uid != uint32(os.Geteuid()) {
			f.Close()
			return errors.New("runtime asset has foreign ownership")
		}
		got, e := io.ReadAll(io.LimitReader(f, int64(len(data))+1))
		if e == nil && string(got) == string(data) {
			if info.Mode().Perm() != mode {
				e = f.Chmod(mode)
			}
			f.Close()
			return e
		}
		f.Close()
	} else if !os.IsNotExist(e) {
		return e
	}
	tmp, e := os.CreateTemp(filepath.Dir(path), ".asset-*")
	if e != nil {
		return e
	}
	n := tmp.Name()
	defer os.Remove(n)
	if _, e = tmp.Write(data); e == nil {
		e = tmp.Sync()
	}
	if x := tmp.Close(); e == nil {
		e = x
	}
	if e == nil {
		e = os.Chmod(n, mode)
	}
	if e == nil {
		e = os.Rename(n, path)
	}
	return e
}

// Cache components are individually opened without following symlinks. Only
// app-owned private cache directories are normalized; ancestors are untouched.
func privateCacheDir(path string) error {
	if e := os.Mkdir(path, 0700); e != nil && !os.IsExist(e) {
		return e
	}
	f, e := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if e != nil {
		return fmt.Errorf("runtime cache directory: %w", e)
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return e
	}
	if own, ok := st.Sys().(*syscall.Stat_t); !ok || own.Uid != uint32(os.Geteuid()) {
		return errors.New("runtime cache directory has foreign ownership")
	}
	if st.Mode().Perm()&0077 != 0 {
		return f.Chmod(st.Mode().Perm() & 0700)
	}
	return nil
}
