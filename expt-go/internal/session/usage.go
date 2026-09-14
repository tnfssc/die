package session

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"godie/internal/core"
)

const maxCostScanFiles = 4096
const maxCostScanBytes int64 = 256 << 20

func addUsage(dst *core.Usage, u core.Usage) {
	dst.Input += u.Input
	dst.Output += u.Output
	dst.CacheRead += u.CacheRead
	dst.CacheWrite += u.CacheWrite
	dst.Cost += u.Cost
}

func entryUsage(e Entry) *core.Usage {
	if e.Usage != nil {
		return e.Usage
	}
	if e.Type != "custom" || e.CustomType != "provider_attempt" {
		return nil
	}
	var data struct {
		Usage *core.Usage `json:"usage"`
	}
	if json.Unmarshal(e.Data, &data) != nil {
		return nil
	}
	return data.Usage
}

func entriesUsage(entries []Entry) core.Usage {
	var total core.Usage
	for _, e := range entries {
		if u := entryUsage(e); u != nil {
			addUsage(&total, *u)
		}
	}
	return total
}

type costSession struct {
	header   Header
	entries  []Entry
	children map[string]bool
	parents  map[string]bool
}

func canonicalSessionPath(path, relativeTo string) string {
	if !filepath.IsAbs(path) {
		path = filepath.Join(relativeTo, path)
	}
	path, _ = filepath.Abs(path)
	path = filepath.Clean(path)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		return resolved
	}
	return path
}

func readCostSession(path string) (*costSession, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, 0, err
	}
	h, entries, _, err := readFile(f, false)
	if err != nil {
		return nil, st.Size(), err
	}
	out := &costSession{header: h, entries: entries, children: map[string]bool{}, parents: map[string]bool{}}
	dir := filepath.Dir(path)
	var explicitParents []string
	hasAgent := false
	for _, e := range entries {
		if e.Type != "custom" {
			continue
		}
		if e.CustomType == "child_launch" {
			var d struct {
				SessionFile string `json:"sessionFile"`
			}
			if json.Unmarshal(e.Data, &d) == nil && d.SessionFile != "" {
				out.children[canonicalSessionPath(d.SessionFile, dir)] = true
			}
		}
		if e.CustomType == "die-agent" {
			hasAgent = true
			var d struct {
				ParentSessionFile string `json:"parentSessionFile"`
			}
			if json.Unmarshal(e.Data, &d) == nil && d.ParentSessionFile != "" {
				explicitParents = append(explicitParents, canonicalSessionPath(d.ParentSessionFile, dir))
			}
		}
	}
	headerParent := ""
	if h.ParentSession != "" {
		headerParent = canonicalSessionPath(h.ParentSession, dir)
	}
	copiedMetadata := false
	if headerParent != "" {
		for _, parent := range explicitParents {
			if parent != headerParent {
				copiedMetadata = true
				break
			}
		}
	}
	if hasAgent && !copiedMetadata {
		for _, parent := range explicitParents {
			out.parents[parent] = true
		}
		if len(explicitParents) == 0 && headerParent != "" {
			out.parents[headerParent] = true
		}
	}
	return out, st.Size(), nil
}

// DescendantUsage totals each reachable child session once. Reachability uses
// both parent child_launch records and child die-agent parent metadata. Scans
// are bounded and malformed sessions or cyclic links cannot amplify totals.
func (s *Session) DescendantUsage() (core.Usage, error) {
	root := canonicalSessionPath(s.File(), "")
	candidates := map[string]bool{root: true}
	stop := errors.New("cost scan file limit")
	err := filepath.WalkDir(filepath.Dir(root), func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if filepath.Ext(path) != ".jsonl" {
			return nil
		}
		candidates[canonicalSessionPath(path, "")] = true
		if len(candidates) > maxCostScanFiles {
			return stop
		}
		return nil
	})
	if errors.Is(err, stop) {
		return core.Usage{}, errors.New("descendant usage scan exceeds 4096 files")
	}
	if err != nil {
		return core.Usage{}, err
	}

	sessions := map[string]*costSession{}
	var bytes int64
	// child_launch may point outside the session directory, so discovery grows
	// this work list, still under the same bounds.
	for changed := true; changed; {
		changed = false
		for path := range candidates {
			if _, ok := sessions[path]; ok {
				continue
			}
			cs, size, readErr := readCostSession(path)
			sessions[path] = cs // nil marks a corrupt or unavailable candidate
			if readErr != nil {
				continue
			}
			bytes += size
			if bytes > maxCostScanBytes {
				return core.Usage{}, errors.New("descendant usage scan exceeds 256 MiB")
			}
			for child := range cs.children {
				if !candidates[child] {
					if len(candidates) >= maxCostScanFiles {
						return core.Usage{}, errors.New("descendant usage scan exceeds 4096 files")
					}
					candidates[child] = true
					changed = true
				}
			}
		}
	}

	reachable := map[string]bool{root: true}
	for changed := true; changed; {
		changed = false
		for path, cs := range sessions {
			if reachable[path] || cs == nil {
				continue
			}
			direct := false
			for parent := range cs.parents {
				if reachable[parent] {
					direct = true
					break
				}
			}
			if !direct {
				for parent, parentSession := range sessions {
					if reachable[parent] && parentSession != nil && parentSession.children[path] {
						direct = true
						break
					}
				}
			}
			if direct {
				reachable[path] = true
				changed = true
			}
		}
	}
	var total core.Usage
	for path := range reachable {
		if path == root {
			continue
		}
		if cs := sessions[path]; cs != nil {
			addUsage(&total, entriesUsage(cs.entries))
		}
	}
	return total, nil
}

// CombinedUsage is active-branch usage plus all reachable descendant usage.
func (s *Session) CombinedUsage() (core.Usage, error) {
	total, err := s.Usage()
	if err != nil {
		return core.Usage{}, err
	}
	children, err := s.DescendantUsage()
	if err != nil {
		return core.Usage{}, err
	}
	addUsage(&total, children)
	return total, nil
}

// DescendantCost returns the monetary component of DescendantUsage.
func (s *Session) DescendantCost() (float64, error) {
	u, err := s.DescendantUsage()
	return u.Cost, err
}

// CombinedCost returns active-session plus descendant monetary cost.
func (s *Session) CombinedCost() (float64, error) {
	u, err := s.CombinedUsage()
	return u.Cost, err
}
