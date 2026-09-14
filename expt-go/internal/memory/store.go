// Package memory stores project-local agent memory as ordinary Markdown files.
//
// The package does not schedule agents, summarize content, or take a project lock.
// A coordinator explicitly prepares a consolidation, calls a provider child, and
// commits the result after the child has terminated successfully.
package memory

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	MaxPendingFiles      = 256
	MaxPendingFileBytes  = 1 << 20
	MaxPendingTotalBytes = 8 << 20

	maxMarkerBytes = 1024
)

var (
	ErrChanged = errors.New("memory content changed")
)

type PendingNote struct {
	Path    string // slash-separated, relative to the project root
	Content string
	SHA256  string
}

type Note struct {
	Path, Content, SHA256 string
}

type SaveReceipt struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type ConsumeResult struct {
	Consumed []string
	Retained []string
}

type Event struct {
	Operation string
	RunID     string
	Message   string
	Count     int
}

type Logger func(Event)

type Store struct {
	root string
	log  Logger
}

func New(root string, logger Logger) (*Store, error) {
	if root == "" {
		return nil, errors.New("memory: project root is required")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("memory: resolve project root: %w", err)
	}
	return &Store{root: absolute, log: logger}, nil
}

func (s *Store) Root() string { return s.root }
func (s *Store) emit(e Event) {
	if s.log != nil {
		s.log(e)
	}
}

func digest(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func slashRelative(root, path string) string {
	r, _ := filepath.Rel(root, path)
	return filepath.ToSlash(r)
}

func checkedDir(path string, create bool) (bool, error) {
	info, err := os.Lstat(path)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return false, fmt.Errorf("memory: refusing to traverse symlink: %s", path)
		}
		if !info.IsDir() {
			return false, fmt.Errorf("memory: managed path is not a directory: %s", path)
		}
		return true, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if !create {
		return false, nil
	}
	if err := os.Mkdir(path, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return false, err
	}
	info, err = os.Lstat(path)
	if err != nil {
		return false, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return false, fmt.Errorf("memory: refusing to traverse symlink: %s", path)
	}
	if !info.IsDir() {
		return false, fmt.Errorf("memory: managed path is not a directory: %s", path)
	}
	return true, nil
}

func (s *Store) notesRoot(create bool) (string, bool, error) {
	agents := filepath.Join(s.root, ".agents")
	ok, err := checkedDir(agents, create)
	if err != nil || !ok {
		return "", false, err
	}
	notes := filepath.Join(agents, "notes")
	ok, err = checkedDir(notes, create)
	if err != nil || !ok {
		return "", false, err
	}
	return notes, true, nil
}

func ensureDirs(root string, segments []string) (string, error) {
	current := root
	for _, segment := range segments {
		current = filepath.Join(current, segment)
		if _, err := checkedDir(current, true); err != nil {
			return "", err
		}
	}
	return current, nil
}

func topicSegments(topic string) ([]string, error) {
	if topic == "" || topic == "." {
		return nil, nil
	}
	if strings.Contains(topic, "\\") {
		return nil, fmt.Errorf("memory: topic must use forward-slash separators")
	}
	parts := strings.Split(topic, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || strings.HasPrefix(p, ".") || strings.ContainsRune(p, 0) {
			return nil, fmt.Errorf("memory: invalid topic %q", topic)
		}
	}
	return parts, nil
}

func readRegular(path string, maximum int64) ([]byte, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if before.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("memory: refusing to read symlink: %s", path)
	}
	if !before.Mode().IsRegular() {
		return nil, fmt.Errorf("memory: managed note is not a regular file: %s", path)
	}
	if maximum >= 0 && before.Size() > maximum {
		return nil, fmt.Errorf("memory: managed note exceeds the %d-byte read limit: %s", maximum, path)
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var reader io.Reader = f
	if maximum >= 0 {
		reader = io.LimitReader(f, maximum+1)
	}
	b, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if maximum >= 0 && int64(len(b)) > maximum {
		return nil, fmt.Errorf("memory: managed note exceeds the %d-byte read limit: %s", maximum, path)
	}
	return b, nil
}

func (s *Store) SnapshotPending() ([]PendingNote, error) {
	notes, ok, err := s.notesRoot(false)
	if err != nil || !ok {
		return nil, err
	}
	pending := filepath.Join(notes, ".pending")
	ok, err = checkedDir(pending, false)
	if err != nil || !ok {
		return nil, err
	}
	entries, err := os.ReadDir(pending)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0)
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		names = append(names, entry.Name())
		if len(names) > MaxPendingFiles {
			return nil, fmt.Errorf("memory: pending memory exceeds the %d-file limit", MaxPendingFiles)
		}
	}
	sort.Strings(names)
	consumedPath := filepath.Join(notes, ".consumed")
	consumedOK, err := checkedDir(consumedPath, false)
	if err != nil {
		return nil, err
	}
	var total int64
	out := make([]PendingNote, 0, len(names))
	for _, name := range names {
		path := filepath.Join(pending, name)
		b, err := readRegular(path, MaxPendingFileBytes)
		if err != nil {
			return nil, err
		}
		total += int64(len(b))
		if total > MaxPendingTotalBytes {
			return nil, fmt.Errorf("memory: pending memory exceeds the %d-byte aggregate limit", MaxPendingTotalBytes)
		}
		record := PendingNote{Path: slashRelative(s.root, path), Content: string(b), SHA256: digest(b)}
		used, err := s.hasMarker(consumedPath, consumedOK, record)
		if err != nil {
			return nil, err
		}
		if !used {
			out = append(out, record)
		}
	}
	s.emit(Event{Operation: "snapshot", Message: "pending snapshot created", Count: len(out)})
	return out, nil
}

func marker(record PendingNote) (string, []byte) {
	identity := digest([]byte(record.Path+"\x00"+record.Content)) + ".json"
	payload, _ := json.Marshal(struct {
		Path   string `json:"path"`
		SHA256 string `json:"hash"`
	}{record.Path, record.SHA256})
	return identity, append(payload, '\n')
}

func (s *Store) hasMarker(dir string, exists bool, record PendingNote) (bool, error) {
	if !exists {
		return false, nil
	}
	name, payload := marker(record)
	got, err := readRegular(filepath.Join(dir, name), maxMarkerBytes)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return string(got) == string(payload), nil
}

func validPendingPath(path string) bool {
	p := filepath.ToSlash(path)
	const prefix = ".agents/notes/.pending/"
	if !strings.HasPrefix(p, prefix) {
		return false
	}
	name := strings.TrimPrefix(p, prefix)
	return name != "" && !strings.Contains(name, "/") && strings.HasSuffix(name, ".md")
}

func (s *Store) Consume(snapshot []PendingNote, stillValid func() bool) (ConsumeResult, error) {
	result := ConsumeResult{}
	valid := func() bool { return stillValid == nil || stillValid() }
	if !valid() {
		for _, r := range snapshot {
			result.Retained = append(result.Retained, r.Path)
		}
		return result, nil
	}
	notes, _, err := s.notesRoot(true)
	if err != nil {
		return result, err
	}
	dir, err := ensureDirs(notes, []string{".consumed"})
	if err != nil {
		return result, err
	}
	for _, record := range snapshot {
		if !valid() || digest([]byte(record.Content)) != record.SHA256 {
			result.Retained = append(result.Retained, record.Path)
			continue
		}
		if !validPendingPath(record.Path) {
			return result, fmt.Errorf("memory: invalid pending note path: %s", record.Path)
		}
		name, payload := marker(record)
		tmp, err := os.CreateTemp(dir, "."+name+".*.tmp")
		if err != nil {
			return result, err
		}
		tmpName := tmp.Name()
		cleanup := func() { tmp.Close(); os.Remove(tmpName) }
		if err = tmp.Chmod(0600); err == nil {
			_, err = tmp.Write(payload)
		}
		if err == nil {
			err = tmp.Sync()
		}
		if closeErr := tmp.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			cleanup()
			return result, err
		}
		if !valid() {
			cleanup()
			result.Retained = append(result.Retained, record.Path)
			continue
		}
		destination := filepath.Join(dir, name)
		err = os.Link(tmpName, destination)
		if errors.Is(err, os.ErrExist) {
			var same bool
			same, err = s.hasMarker(dir, true, record)
			if err == nil && !same {
				err = errors.New("memory: conflicting consumption marker")
			}
		}
		cleanup()
		if err != nil {
			return result, err
		}
		result.Consumed = append(result.Consumed, record.Path)
	}
	s.emit(Event{Operation: "consume", Message: "pending snapshots marked consumed", Count: len(result.Consumed)})
	return result, nil
}

func (s *Store) Read(topic string) (*Note, error) {
	segments, err := topicSegments(topic)
	if err != nil {
		return nil, err
	}
	notes, ok, err := s.notesRoot(false)
	if err != nil || !ok {
		return nil, err
	}
	parent := notes
	for _, segment := range segments {
		parent = filepath.Join(parent, segment)
		ok, err = checkedDir(parent, false)
		if err != nil || !ok {
			return nil, err
		}
	}
	path := filepath.Join(parent, "index.md")
	b, err := readRegular(path, -1)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &Note{Path: slashRelative(s.root, path), Content: string(b), SHA256: digest(b)}, nil
}

func (s *Store) Save(topic, content string, expectedSHA256 *string) (SaveReceipt, error) {
	segments, err := topicSegments(topic)
	if err != nil {
		return SaveReceipt{}, err
	}
	notes, _, err := s.notesRoot(true)
	if err != nil {
		return SaveReceipt{}, err
	}
	parent, err := ensureDirs(notes, segments)
	if err != nil {
		return SaveReceipt{}, err
	}
	path := filepath.Join(parent, "index.md")
	existing, readErr := readRegular(path, -1)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return SaveReceipt{}, readErr
	}
	if errors.Is(readErr, os.ErrNotExist) {
		if expectedSHA256 != nil {
			return SaveReceipt{}, fmt.Errorf("%w: %s does not exist", ErrChanged, slashRelative(s.root, path))
		}
	} else if expectedSHA256 == nil || digest(existing) != *expectedSHA256 {
		return SaveReceipt{}, fmt.Errorf("%w: %s", ErrChanged, slashRelative(s.root, path))
	}
	tmp, err := os.CreateTemp(parent, ".index.md.*.tmp")
	if err != nil {
		return SaveReceipt{}, err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err = tmp.Chmod(0600); err == nil {
		_, err = tmp.WriteString(content)
	}
	if err == nil {
		err = tmp.Sync()
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return SaveReceipt{}, err
	}
	if err = os.Rename(tmpName, path); err != nil {
		return SaveReceipt{}, err
	}
	receipt := SaveReceipt{Path: slashRelative(s.root, path), SHA256: digest([]byte(content))}
	s.emit(Event{Operation: "save", Message: "consolidated index saved", Count: 1})
	return receipt, nil
}

func (s *Store) VerifySave(receipt SaveReceipt) bool {
	p := filepath.ToSlash(receipt.Path)
	const prefix = ".agents/notes/"
	if !strings.HasPrefix(p, prefix) || strings.Contains(p, "/.pending/") || !(p == prefix+"index.md" || strings.HasSuffix(p, "/index.md")) {
		return false
	}
	topic := ""
	if p != prefix+"index.md" {
		topic = strings.TrimSuffix(strings.TrimPrefix(p, prefix), "/index.md")
	}
	note, err := s.Read(topic)
	return err == nil && note != nil && note.Path == p && note.SHA256 == receipt.SHA256
}

func randomID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
