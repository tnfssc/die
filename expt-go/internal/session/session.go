// Package session provides Godie's append-only session tree and product state.
package session

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"godie/internal/core"
)

var ErrLegacyReadOnly = errors.New("legacy Pi session is read-only; use OpenReadOnly or migrate an explicit copy")

const maxFileBytes int64 = 64 << 20
const maxEntries = 100000
const maxEntryBytes = 4 << 20
const branchSelectionType = "branch_selection"

type branchSelection struct {
	LeafID string `json:"leafId"`
}

type Metadata struct {
	Role              string `json:"role,omitempty"`
	Type              string `json:"type,omitempty"`
	Depth             int    `json:"depth,omitempty"`
	TaskID            string `json:"taskId,omitempty"`
	Model             string `json:"model,omitempty"`
	ParentSessionID   string `json:"parentSessionId,omitempty"`
	ParentSessionFile string `json:"parentSessionFile,omitempty"`
	RootSessionID     string `json:"rootSessionId,omitempty"`
}

type Config struct {
	StateDir    string
	SessionFile string
	CWD         string
	ID          string
	Metadata    Metadata
	Now         func() time.Time
	NewID       func(string) string
}

type Header struct {
	Type          string   `json:"type"`
	Version       int      `json:"version"`
	App           string   `json:"app,omitempty"`
	ID            string   `json:"id"`
	Timestamp     string   `json:"timestamp"`
	CWD           string   `json:"cwd"`
	ParentSession string   `json:"parentSession,omitempty"`
	Metadata      Metadata `json:"metadata,omitempty"`
}

type Entry struct {
	Type       string          `json:"type"`
	ID         string          `json:"id"`
	ParentID   *string         `json:"parentId"`
	Timestamp  string          `json:"timestamp"`
	Message    *core.Message   `json:"message,omitempty"`
	Usage      *core.Usage     `json:"usage,omitempty"`
	CustomType string          `json:"customType,omitempty"`
	Data       json.RawMessage `json:"data,omitempty"`
	RawMessage json.RawMessage `json:"-"`
}

func (e *Entry) UnmarshalJSON(b []byte) error {
	type wire struct {
		Type       string          `json:"type"`
		ID         string          `json:"id"`
		ParentID   *string         `json:"parentId"`
		Timestamp  string          `json:"timestamp"`
		Message    json.RawMessage `json:"message"`
		Usage      *core.Usage     `json:"usage"`
		CustomType string          `json:"customType"`
		Data       json.RawMessage `json:"data"`
	}
	var w wire
	if err := json.Unmarshal(b, &w); err != nil {
		return err
	}
	e.Type, e.ID, e.ParentID, e.Timestamp, e.CustomType, e.Data, e.Usage = w.Type, w.ID, w.ParentID, w.Timestamp, w.CustomType, w.Data, w.Usage
	if len(w.Message) > 0 && string(w.Message) != "null" {
		var m core.Message
		if err := json.Unmarshal(w.Message, &m); err != nil {
			var raw struct {
				Hidden  bool   `json:"hidden"`
				Role    string `json:"role"`
				Content any    `json:"content"`
			}
			if err = json.Unmarshal(w.Message, &raw); err != nil {
				return err
			}
			m.Role = raw.Role
			m.Hidden = raw.Hidden
			switch c := raw.Content.(type) {
			case string:
				m.Content = c
			case []any:
				var parts []string
				for _, v := range c {
					if p, ok := v.(map[string]any); ok && p["type"] == "text" {
						if text, ok := p["text"].(string); ok {
							parts = append(parts, text)
						}
					}
				}
				m.Content = strings.Join(parts, "\n")
			}
			m.Native = append(json.RawMessage(nil), w.Message...)
		}
		e.Message = &m
		e.RawMessage = append(json.RawMessage(nil), w.Message...)
	}
	return nil
}

type Session struct {
	goalMu  sync.Mutex
	mu      sync.RWMutex
	cfg     Config
	header  Header
	file    *os.File
	lock    *os.File
	entries []Entry
	byID    map[string]int
	leaf    string
	closed  bool
}

func defaultID(prefix string) string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return prefix + "_" + hex.EncodeToString(b[:])
}
func normalize(c Config) Config {
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.NewID == nil {
		c.NewID = defaultID
	}
	return c
}
func sessionPath(c Config) (string, error) {
	if c.SessionFile != "" {
		return filepath.Abs(c.SessionFile)
	}
	if c.StateDir == "" {
		return "", errors.New("StateDir or SessionFile is required")
	}
	id := c.ID
	if id == "" {
		id = c.NewID("session")
	}
	c.ID = id
	return filepath.Abs(filepath.Join(c.StateDir, "sessions", id+".jsonl"))
}
func New(c Config) (*Session, error) {
	c = normalize(c)
	path, err := sessionPath(c)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	lock, err := takeLock(path)
	if err != nil {
		return nil, err
	}
	fail := func(e error) (*Session, error) { _ = lock.Close(); return nil, e }
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return fail(err)
	}
	id := c.ID
	if id == "" {
		id = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		if id == "" {
			id = c.NewID("session")
		}
	}
	cwd := c.CWD
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	h := Header{Type: "session", Version: 2, App: "godie", ID: id, Timestamp: c.Now().UTC().Format(time.RFC3339Nano), CWD: cwd, Metadata: c.Metadata, ParentSession: c.Metadata.ParentSessionFile}
	s := &Session{cfg: c, header: h, file: f, lock: lock, byID: map[string]int{}}
	if err = s.writeLine(h); err != nil {
		f.Close()
		os.Remove(path)
		return fail(err)
	}
	if c.Metadata.Depth > 0 || c.Metadata.Role != "" || c.Metadata.Type != "" {
		typ := c.Metadata.Type
		if typ == "" {
			typ = c.Metadata.Role
		}
		data := map[string]any{"taskId": c.Metadata.TaskID, "role": c.Metadata.Role, "type": typ, "model": c.Metadata.Model, "depth": c.Metadata.Depth, "parentSessionId": c.Metadata.ParentSessionID, "parentSessionFile": c.Metadata.ParentSessionFile, "rootSessionId": c.Metadata.RootSessionID}
		if _, err = s.AppendCustom("die-agent", data); err != nil {
			s.Close()
			return nil, err
		}
	}
	return s, nil
}

func takeLock(path string) (*os.File, error) {
	// The lock inode is stable and intentionally remains on disk. Removing a
	// lock file permits a second process to lock a new inode while an existing
	// writer still owns the old one. flock is released by the kernel on close or
	// process death, so a crashed writer never leaves a stale lock.
	f, e := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		_ = f.Close()
		if errors.Is(e, syscall.EWOULDBLOCK) || errors.Is(e, syscall.EAGAIN) {
			return nil, fmt.Errorf("session already has a writer: %w", e)
		}
		return nil, e
	}
	if e = f.Truncate(0); e == nil {
		_, e = fmt.Fprintf(f, "%d\n", os.Getpid())
	}
	if e != nil {
		_ = f.Close()
		return nil, e
	}
	return f, nil
}

func Open(c Config) (*Session, error) {
	c = normalize(c)
	if c.SessionFile == "" {
		return nil, errors.New("SessionFile is required to open")
	}
	path, err := filepath.Abs(c.SessionFile)
	if err != nil {
		return nil, err
	}
	lock, err := takeLock(path)
	if err != nil {
		return nil, err
	}
	fail := func(e error) (*Session, error) { _ = lock.Close(); return nil, e }
	f, err := os.OpenFile(path, os.O_RDWR, 0600)
	if err != nil {
		return fail(err)
	}
	h, es, torn, err := readFile(f, true)
	if err != nil {
		f.Close()
		return fail(err)
	}
	if h.App != "godie" {
		f.Close()
		return fail(ErrLegacyReadOnly)
	}
	if torn >= 0 {
		if err = f.Truncate(torn); err != nil {
			f.Close()
			return fail(err)
		}
		if err = f.Sync(); err != nil {
			f.Close()
			return fail(err)
		}
	} else if st, _ := f.Stat(); st != nil && st.Size() > 0 {
		var last [1]byte
		if _, e := f.ReadAt(last[:], st.Size()-1); e == nil && last[0] != '\n' {
			if _, e = f.Seek(0, io.SeekEnd); e != nil {
				f.Close()
				return fail(e)
			}
			if _, e = f.Write([]byte{"\n"[0]}); e != nil {
				f.Close()
				return fail(e)
			}
			if e = f.Sync(); e != nil {
				f.Close()
				return fail(e)
			}
		}
	}
	s := &Session{cfg: c, header: h, file: f, lock: lock, entries: es, byID: map[string]int{}}
	if err = s.index(); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}

func readFile(f *os.File, allowTorn bool) (Header, []Entry, int64, error) {
	var h Header
	st, e := f.Stat()
	if e != nil {
		return h, nil, -1, e
	}
	if !st.Mode().IsRegular() {
		return h, nil, -1, errors.New("session must be a regular file")
	}
	if st.Size() > maxFileBytes {
		return h, nil, -1, errors.New("session exceeds 64 MiB limit")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return h, nil, -1, e
	}
	b, e := io.ReadAll(io.LimitReader(f, maxFileBytes+1))
	if e != nil {
		return h, nil, -1, e
	}
	lines := bytes.SplitAfter(b, []byte{'\n'})
	var es []Entry
	var off int64
	for i, line := range lines {
		if len(line) == 0 {
			continue
		}
		complete := line[len(line)-1] == '\n'
		raw := bytes.TrimSpace(line)
		if len(raw) == 0 {
			off += int64(len(line))
			continue
		}
		if len(raw) > maxEntryBytes {
			return h, nil, -1, errors.New("session entry exceeds 4 MiB limit")
		}
		if i == 0 {
			if e = json.Unmarshal(raw, &h); e != nil {
				return h, nil, -1, fmt.Errorf("invalid session header: %w", e)
			}
			if h.Type != "session" || h.Version < 2 || h.ID == "" || len(h.ID) > 128 || strings.Contains(h.ID, ":") {
				return h, nil, -1, errors.New("invalid session header")
			}
		} else {
			var x Entry
			if e = json.Unmarshal(raw, &x); e != nil {
				if allowTorn && !complete {
					return h, es, off, nil
				}
				return h, nil, -1, fmt.Errorf("invalid session entry: %w", e)
			}
			es = append(es, x)
			if len(es) > maxEntries {
				return h, nil, -1, errors.New("session exceeds 100000 entries")
			}
		}
		off += int64(len(line))
	}
	return h, es, -1, nil
}
func (s *Session) index() error {
	for i, e := range s.entries {
		if e.ID == "" {
			return errors.New("session entry has empty id")
		}
		if _, ok := s.byID[e.ID]; ok {
			return fmt.Errorf("duplicate entry id %q", e.ID)
		}
		s.byID[e.ID] = i
		if e.Type == branchSelectionType {
			if e.ParentID != nil {
				return errors.New("branch selection must not have a parent")
			}
			var selection branchSelection
			if json.Unmarshal(e.Data, &selection) != nil {
				return errors.New("invalid branch selection")
			}
			if selection.LeafID != "" {
				selected, ok := s.byID[selection.LeafID]
				if !ok || s.entries[selected].Type == branchSelectionType {
					return fmt.Errorf("branch selection has unknown leaf %q", selection.LeafID)
				}
			}
			s.leaf = selection.LeafID
			continue
		}
		if e.ParentID != nil {
			parent, ok := s.byID[*e.ParentID]
			if !ok || s.entries[parent].Type == branchSelectionType {
				return fmt.Errorf("entry %q has missing parent", e.ID)
			}
		}
		s.leaf = e.ID
	}
	return nil
}
func (s *Session) writeLine(v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	if len(b) > maxEntryBytes {
		return errors.New("session entry exceeds 4 MiB limit")
	}
	b = append(b, '\n')
	if _, e = s.file.Seek(0, io.SeekEnd); e != nil {
		return e
	}
	if _, e = s.file.Write(b); e != nil {
		return e
	}
	return s.file.Sync()
}
func (s *Session) append(e Entry) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Entry{}, errors.New("session is closed")
	}
	if len(s.entries) >= maxEntries {
		return Entry{}, errors.New("session exceeds 100000 entries")
	}
	e.ID = s.cfg.NewID("entry")
	if _, ok := s.byID[e.ID]; ok {
		return Entry{}, errors.New("generated duplicate entry id")
	}
	if s.leaf != "" {
		p := s.leaf
		e.ParentID = &p
	}
	e.Timestamp = s.cfg.Now().UTC().Format(time.RFC3339Nano)
	if err := s.writeLine(e); err != nil {
		return Entry{}, err
	}
	s.entries = append(s.entries, e)
	s.byID[e.ID] = len(s.entries) - 1
	s.leaf = e.ID
	return cloneEntry(e), nil
}
func (s *Session) AppendMessage(m core.Message) (Entry, error) {
	return s.AppendMessageWithUsage(m, nil)
}
func (s *Session) AppendMessageWithUsage(m core.Message, usage *core.Usage) (Entry, error) {
	m2 := m
	var u *core.Usage
	if usage != nil {
		copy := *usage
		u = &copy
	}
	return s.append(Entry{Type: "message", Message: &m2, Usage: u})
}
func (s *Session) AppendCustom(kind string, data any) (Entry, error) {
	if strings.TrimSpace(kind) == "" {
		return Entry{}, errors.New("custom type is required")
	}
	b, e := json.Marshal(data)
	if e != nil {
		return Entry{}, e
	}
	return s.append(Entry{Type: "custom", CustomType: kind, Data: b})
}
func cloneEntry(e Entry) Entry {
	b, _ := json.Marshal(e)
	var x Entry
	_ = json.Unmarshal(b, &x)
	return x
}
func (s *Session) Branch(from ...string) ([]Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	leaf := s.leaf
	if len(from) > 1 {
		return nil, errors.New("at most one leaf id")
	}
	if len(from) == 1 {
		leaf = from[0]
	}
	if leaf == "" {
		return []Entry{}, nil
	}
	var rev []Entry
	seen := map[string]bool{}
	for leaf != "" {
		if seen[leaf] {
			return nil, errors.New("cyclic branch")
		}
		seen[leaf] = true
		i, ok := s.byID[leaf]
		if !ok {
			return nil, fmt.Errorf("unknown leaf %q", leaf)
		}
		e := s.entries[i]
		rev = append(rev, cloneEntry(e))
		if e.ParentID == nil {
			break
		}
		leaf = *e.ParentID
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev, nil
}
func (s *Session) Messages() ([]core.Message, error) {
	es, e := s.Branch()
	if e != nil {
		return nil, e
	}
	out := []core.Message{}
	for _, x := range es {
		if x.Type == "message" && x.Message != nil {
			out = append(out, *x.Message)
		}
	}
	return out, nil
}
func (s *Session) Usage() (core.Usage, error) {
	entries, err := s.Branch()
	if err != nil {
		return core.Usage{}, err
	}
	return entriesUsage(entries), nil
}

func (s *Session) Resume(leaf string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("session is closed")
	}
	if len(s.entries) >= maxEntries {
		return errors.New("session exceeds 100000 entries")
	}
	if leaf != "" {
		i, ok := s.byID[leaf]
		if !ok || s.entries[i].Type == branchSelectionType {
			return fmt.Errorf("unknown leaf %q", leaf)
		}
	}
	e := Entry{Type: branchSelectionType, ID: s.cfg.NewID("entry"), Timestamp: s.cfg.Now().UTC().Format(time.RFC3339Nano)}
	if _, ok := s.byID[e.ID]; ok {
		return errors.New("generated duplicate entry id")
	}
	e.Data, _ = json.Marshal(branchSelection{LeafID: leaf})
	if err := s.writeLine(e); err != nil {
		return err
	}
	s.entries = append(s.entries, e)
	s.byID[e.ID] = len(s.entries) - 1
	s.leaf = leaf
	return nil
}
func (s *Session) ID() string     { return s.header.ID }
func (s *Session) File() string   { return s.file.Name() }
func (s *Session) CWD() string    { return s.header.CWD }
func (s *Session) LeafID() string { s.mu.RLock(); defer s.mu.RUnlock(); return s.leaf }
func (s *Session) Header() Header { return s.header }
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	e := s.file.Close()
	le := s.lock.Close()
	if e != nil {
		return e
	}
	return le
}

type Reader struct {
	header  Header
	entries []Entry
	byID    map[string]int
	leaf    string
	path    string
}

func OpenReadOnly(path string) (*Reader, error) {
	abs, e := filepath.Abs(path)
	if e != nil {
		return nil, e
	}
	f, e := os.OpenFile(abs, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	h, es, _, e := readFile(f, false)
	if e != nil {
		return nil, e
	}
	r := &Reader{header: h, entries: es, byID: map[string]int{}, path: abs}
	for i, x := range es {
		if x.ID == "" {
			return nil, errors.New("entry has empty id")
		}
		if _, ok := r.byID[x.ID]; ok {
			return nil, errors.New("duplicate entry id")
		}
		r.byID[x.ID] = i
		if x.Type == branchSelectionType {
			if x.ParentID != nil {
				return nil, errors.New("invalid branch selection")
			}
			var selection branchSelection
			if json.Unmarshal(x.Data, &selection) != nil {
				return nil, errors.New("invalid branch selection")
			}
			if selection.LeafID != "" {
				selected, ok := r.byID[selection.LeafID]
				if !ok || es[selected].Type == branchSelectionType {
					return nil, errors.New("invalid branch selection")
				}
			}
			r.leaf = selection.LeafID
			continue
		}
		if x.ParentID != nil {
			parent, ok := r.byID[*x.ParentID]
			if !ok || es[parent].Type == branchSelectionType {
				return nil, errors.New("broken branch")
			}
		}
		r.leaf = x.ID
	}
	return r, nil
}
func (r *Reader) Header() Header { return r.header }
func (r *Reader) ID() string     { return r.header.ID }
func (r *Reader) File() string   { return r.path }
func (r *Reader) CWD() string    { return r.header.CWD }
func (r *Reader) LeafID() string { return r.leaf }
func (r *Reader) Branch(from ...string) ([]Entry, error) {
	leaf := r.leaf
	if len(from) > 1 {
		return nil, errors.New("at most one leaf id")
	}
	if len(from) == 1 {
		leaf = from[0]
	}
	var rev []Entry
	seen := map[string]bool{}
	for leaf != "" {
		if seen[leaf] {
			return nil, errors.New("cyclic branch")
		}
		seen[leaf] = true
		i, ok := r.byID[leaf]
		if !ok {
			return nil, errors.New("unknown leaf")
		}
		x := r.entries[i]
		rev = append(rev, cloneEntry(x))
		if x.ParentID == nil {
			break
		}
		leaf = *x.ParentID
	}
	for i, j := 0, len(rev)-1; i < j; i, j = i+1, j-1 {
		rev[i], rev[j] = rev[j], rev[i]
	}
	return rev, nil
}
