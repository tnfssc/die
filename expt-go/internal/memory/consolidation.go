package memory

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxReceiptBytes          = 64 << 10
	MaxReceiptFiles          = 256
	MaxReceiptFileBytes      = 2 << 20
	MaxReceiptAggregateBytes = 16 << 20
)

var (
	ErrRootOnly            = errors.New("memory: consolidation is root-only")
	ErrNoPending           = errors.New("memory: no pending Markdown notes")
	ErrInvalidProfile      = errors.New("memory: profile must be fast or normal")
	ErrConstraintsRequired = errors.New("memory: explicit constraints are required")
	ErrWorkerFailed        = errors.New("memory: consolidation worker failed")
	ErrInvalidReceipt      = errors.New("memory: invalid consolidation receipt")
	ErrRunInvalidated      = errors.New("memory: consolidation ownership changed")
)

type PrepareRequest struct {
	// Root must be derived by the coordinator from restored session identity.
	// False is denied; environment depth alone is not suitable evidence.
	Root        bool
	Profile     string
	Constraints string
}

// Preparation is inert: preparing does not call a model or start a job.
// The coordinator gives Prompt to one provider child and asks it to write ReceiptPath.
type Preparation struct {
	ID          string
	Profile     string
	Constraints string
	Paths       []string
	ReceiptPath string
	Prompt      string

	root     string
	snapshot []PendingNote
}

type Completion struct {
	// Root must reflect restored identity again at commit time.
	Root      bool
	Completed bool
	ExitCode  int
	// StillValid may check session/generation ownership during marker publication.
	StillValid func() bool
}

type CommitResult struct {
	Consumed []string
	Retained []string
}

type consolidationReceipt struct {
	Files []receiptFile `json:"files"`
}
type receiptFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

func (s *Store) Prepare(req PrepareRequest) (*Preparation, error) {
	if !req.Root {
		return nil, ErrRootOnly
	}
	if req.Profile != "fast" && req.Profile != "normal" {
		return nil, ErrInvalidProfile
	}
	constraints := strings.TrimSpace(req.Constraints)
	if constraints == "" {
		return nil, ErrConstraintsRequired
	}
	snapshot, err := s.SnapshotPending()
	if err != nil {
		return nil, err
	}
	if len(snapshot) == 0 {
		return nil, ErrNoPending
	}
	id, err := randomID()
	if err != nil {
		return nil, err
	}
	notes, ok, err := s.notesRoot(false)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoPending
	}
	receipt := filepath.Join(notes, ".consolidation-"+id+".json")
	paths := make([]string, len(snapshot))
	for i, n := range snapshot {
		paths[i] = n.Path
	}
	prompt := consolidationPrompt(s.root, paths, receipt, constraints)
	p := &Preparation{ID: id, Profile: req.Profile, Constraints: constraints, Paths: paths, ReceiptPath: receipt, Prompt: prompt, root: s.root, snapshot: snapshot}
	s.emit(Event{Operation: "prepare", RunID: id, Message: "explicit consolidation prepared", Count: len(snapshot)})
	return p, nil
}

func consolidationPrompt(root string, paths []string, receipt, constraints string) string {
	return "Consolidate project memory from the listed pending Markdown notes.\n" +
		"Use ordinary filesystem operations only under " + filepath.Join(root, ".agents", "notes") + ". Read existing indexes selectively, reconcile facts, and save durable Markdown. Do not run git.\n" +
		"Applicable user constraints (these remain binding): " + constraints + "\n" +
		"Pending snapshot paths (only these belong to this run):\n- " + strings.Join(paths, "\n- ") + "\n" +
		"The root .agents/notes/index.md must exist after saving. Save notes first. Then write " + receipt + " as JSON {\"files\":[{\"path\":\"index.md\",\"sha256\":\"<lowercase SHA-256 of exact bytes>\"}]}, listing every saved Markdown path relative to .agents/notes. Do not write the receipt before all notes are durable.\n"
}

func retain(prep *Preparation) CommitResult {
	r := CommitResult{}
	for _, n := range prep.snapshot {
		r.Retained = append(r.Retained, n.Path)
	}
	return r
}

// Commit verifies the provider child's terminal result and exact saved bytes before
// publishing consumed markers. Any error retains every input snapshot. Partial child
// writes are intentionally left for a later reconciliation; only its nonce receipt is removed.
func (s *Store) Commit(prep *Preparation, completion Completion) (result CommitResult, err error) {
	if prep == nil || prep.root != s.root || prep.ReceiptPath != filepath.Join(s.root, ".agents", "notes", ".consolidation-"+prep.ID+".json") {
		return result, fmt.Errorf("%w: preparation does not belong to this store", ErrInvalidReceipt)
	}
	result = retain(prep)
	defer os.Remove(prep.ReceiptPath)
	if !completion.Root {
		return result, ErrRootOnly
	}
	valid := func() bool { return completion.StillValid == nil || completion.StillValid() }
	if !valid() {
		return result, ErrRunInvalidated
	}
	if !completion.Completed || completion.ExitCode != 0 {
		s.emit(Event{Operation: "commit", RunID: prep.ID, Message: "worker failed; snapshots retained", Count: len(result.Retained)})
		return result, ErrWorkerFailed
	}
	if err = s.verifyReceipt(prep.ReceiptPath); err != nil {
		s.emit(Event{Operation: "commit", RunID: prep.ID, Message: "receipt invalid; snapshots retained", Count: len(result.Retained)})
		return result, err
	}
	consumed, err := s.Consume(prep.snapshot, valid)
	if err != nil {
		return result, err
	}
	result = CommitResult{Consumed: consumed.Consumed, Retained: consumed.Retained}
	if len(result.Retained) != 0 {
		return result, ErrRunInvalidated
	}
	s.emit(Event{Operation: "commit", RunID: prep.ID, Message: "consolidation committed", Count: len(result.Consumed)})
	return result, nil
}

func safeReceiptPath(path string) bool {
	if path == "" || filepath.IsAbs(path) || strings.Contains(path, "\\") {
		return false
	}
	parts := strings.Split(path, "/")
	for _, p := range parts {
		if p == "" || p == "." || p == ".." || strings.HasPrefix(p, ".") {
			return false
		}
	}
	return strings.HasSuffix(strings.ToLower(path), ".md")
}

func validHexSHA(v string) bool {
	if len(v) != 64 {
		return false
	}
	for _, c := range v {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (s *Store) verifyReceipt(path string) error {
	b, err := readRegular(path, MaxReceiptBytes)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidReceipt, err)
	}
	var receipt consolidationReceipt
	if err = json.Unmarshal(b, &receipt); err != nil {
		return fmt.Errorf("%w: malformed JSON", ErrInvalidReceipt)
	}
	if len(receipt.Files) < 1 || len(receipt.Files) > MaxReceiptFiles {
		return fmt.Errorf("%w: invalid file list", ErrInvalidReceipt)
	}
	notes, ok, err := s.notesRoot(false)
	if err != nil || !ok {
		return fmt.Errorf("%w: unsafe notes root", ErrInvalidReceipt)
	}
	seen := map[string]bool{}
	hasRoot := false
	var total int64
	for _, item := range receipt.Files {
		if !safeReceiptPath(item.Path) || !validHexSHA(item.SHA256) || seen[item.Path] {
			return fmt.Errorf("%w: invalid file entry", ErrInvalidReceipt)
		}
		seen[item.Path] = true
		if item.Path == "index.md" {
			hasRoot = true
		}
		segments := strings.Split(item.Path, "/")
		parent := notes
		for _, segment := range segments[:len(segments)-1] {
			parent = filepath.Join(parent, segment)
			ok, err = checkedDir(parent, false)
			if err != nil || !ok {
				return fmt.Errorf("%w: unsafe file ancestor", ErrInvalidReceipt)
			}
		}
		saved := filepath.Join(notes, filepath.FromSlash(item.Path))
		data, readErr := readRegular(saved, MaxReceiptFileBytes)
		if readErr != nil {
			return fmt.Errorf("%w: unreadable saved file", ErrInvalidReceipt)
		}
		total += int64(len(data))
		if total > MaxReceiptAggregateBytes {
			return fmt.Errorf("%w: saved files exceed aggregate limit", ErrInvalidReceipt)
		}
		if digest(data) != item.SHA256 {
			return fmt.Errorf("%w: saved note changed or does not match", ErrInvalidReceipt)
		}
	}
	if !hasRoot {
		return fmt.Errorf("%w: receipt does not list index.md", ErrInvalidReceipt)
	}
	return nil
}
