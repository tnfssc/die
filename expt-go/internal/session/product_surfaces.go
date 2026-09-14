package session

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// TreeNode is a stable, presentation-neutral view of one append-only entry.
type TreeNode struct {
	ID             string  `json:"id"`
	ParentID       *string `json:"parentId,omitempty"`
	Type           string  `json:"type"`
	Timestamp      string  `json:"timestamp"`
	Role           string  `json:"role,omitempty"`
	Preview        string  `json:"preview,omitempty"`
	OnActiveBranch bool    `json:"onActiveBranch"`
	ActiveLeaf     bool    `json:"activeLeaf"`
}

// Tree returns every non-control entry, including abandoned branches. It does
// not mutate the selected branch.
func (s *Session) Tree() ([]TreeNode, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.closed {
		return nil, errors.New("session is closed")
	}
	active := map[string]bool{}
	for id := s.leaf; id != ""; {
		if active[id] {
			return nil, errors.New("cyclic branch")
		}
		active[id] = true
		i, ok := s.byID[id]
		if !ok {
			return nil, errors.New("broken active branch")
		}
		if s.entries[i].ParentID == nil {
			break
		}
		id = *s.entries[i].ParentID
	}
	out := make([]TreeNode, 0, len(s.entries))
	for _, e := range s.entries {
		if e.Type == branchSelectionType {
			continue
		}
		n := TreeNode{ID: e.ID, ParentID: e.ParentID, Type: e.Type, Timestamp: e.Timestamp, OnActiveBranch: active[e.ID], ActiveLeaf: e.ID == s.leaf}
		if e.Message != nil {
			n.Role = e.Message.Role
			n.Preview = boundedPreview(e.Message.Content, 120)
		} else if e.CustomType != "" {
			n.Preview = e.CustomType
		}
		out = append(out, n)
	}
	return out, nil
}

func boundedPreview(v string, max int) string {
	v = strings.Join(strings.Fields(v), " ")
	r := []rune(v)
	if len(r) > max {
		return string(r[:max-1]) + "…"
	}
	return v
}

type CatalogEntry struct {
	Path      string   `json:"path"`
	ID        string   `json:"id"`
	CWD       string   `json:"cwd"`
	Timestamp string   `json:"timestamp"`
	Metadata  Metadata `json:"metadata,omitempty"`
}

// Catalog lists readable native sessions. A malformed file is ignored so one
// damaged archive cannot make the resume picker unusable.
func Catalog(dir, cwd string) ([]CatalogEntry, error) {
	items, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []CatalogEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []CatalogEntry{}
	for _, it := range items {
		if it.IsDir() || !strings.HasSuffix(it.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(dir, it.Name())
		f, e := os.Open(path)
		if e != nil {
			continue
		}
		scanner := bufio.NewScanner(io.LimitReader(f, maxEntryBytes+1))
		scanner.Buffer(make([]byte, 1024), maxEntryBytes)
		ok := scanner.Scan()
		line := append([]byte(nil), scanner.Bytes()...)
		f.Close()
		if !ok {
			continue
		}
		var h Header
		if json.Unmarshal(line, &h) != nil || h.Type != "session" || h.App != "godie" || h.ID == "" || (cwd != "" && h.CWD != cwd) {
			continue
		}
		abs, e := filepath.Abs(path)
		if e != nil {
			continue
		}
		out = append(out, CatalogEntry{abs, h.ID, h.CWD, h.Timestamp, h.Metadata})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out, nil
}

// ExportJSONL copies the durable archive to a newly-created file.
func (s *Session) ExportJSONL(destination string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return "", errors.New("session is closed")
	}
	if destination == "" {
		return "", errors.New("export path is required")
	}
	src, err := filepath.Abs(s.file.Name())
	if err != nil {
		return "", err
	}
	dst, err := filepath.Abs(destination)
	if err != nil {
		return "", err
	}
	if src == dst {
		return "", errors.New("export path is the active session")
	}
	if err = s.file.Sync(); err != nil {
		return "", err
	}
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	ok := false
	defer func() {
		out.Close()
		if !ok {
			os.Remove(dst)
		}
	}()
	if _, err = io.Copy(out, in); err != nil {
		return "", err
	}
	if err = out.Sync(); err != nil {
		return "", err
	}
	if err = out.Close(); err != nil {
		return "", err
	}
	ok = true
	return dst, nil
}

// ExportHTML produces a self-contained, escaped transcript of the active branch.
func (s *Session) ExportHTML(destination string) (string, error) {
	entries, err := s.Branch()
	if err != nil {
		return "", err
	}
	if destination == "" {
		return "", errors.New("export path is required")
	}
	dst, err := filepath.Abs(destination)
	if err != nil {
		return "", err
	}
	f, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	ok := false
	defer func() {
		f.Close()
		if !ok {
			os.Remove(dst)
		}
	}()
	_, err = fmt.Fprintln(f, "<!doctype html><meta charset=\"utf-8\"><title>Godie session</title><style>body{font:16px system-ui;max-width:70ch;margin:auto;padding:2rem}article{white-space:pre-wrap;border-top:1px solid #ccc;padding:1rem 0}</style>")
	if err == nil {
		for _, e := range entries {
			if e.Message != nil {
				_, err = fmt.Fprintf(f, "<article><strong>%s</strong>\n%s</article>\n", html.EscapeString(e.Message.Role), html.EscapeString(e.Message.Content))
				if err != nil {
					break
				}
			}
		}
	}
	if err == nil {
		err = f.Sync()
	}
	if err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	ok = true
	return dst, nil
}
