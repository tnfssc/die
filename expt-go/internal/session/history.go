package session

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const (
	maxQueryChars    = 500
	maxSearchResults = 50
	maxExcerptChars  = 600
	maxReadChars     = 16000
	maxCursorChars   = 16000
	refPrefix        = "die-history-v1"
	cursorPrefix     = "dhc1."
)

type HistoryProvenance struct {
	Source       string  `json:"source"`
	Scope        string  `json:"scope"`
	SessionID    string  `json:"sessionId"`
	SessionFile  string  `json:"sessionFile,omitempty"`
	CWD          string  `json:"cwd"`
	BranchLeafID *string `json:"branchLeafId"`
	EntryID      string  `json:"entryId"`
	Timestamp    string  `json:"timestamp"`
	Role         string  `json:"role"`
	Part         int     `json:"part"`
}
type HistorySearchMatch struct {
	Ref         string            `json:"ref"`
	Excerpt     string            `json:"excerpt"`
	MatchOffset int               `json:"matchOffset"`
	TextLength  int               `json:"textLength"`
	Provenance  HistoryProvenance `json:"provenance"`
}
type HistorySearchResult struct {
	Matches        []HistorySearchMatch `json:"matches"`
	NextCursor     string               `json:"nextCursor,omitempty"`
	ScannedEntries int                  `json:"scannedEntries"`
	ScanLimited    bool                 `json:"scanLimited"`
}
type HistoryReadResult struct {
	Ref   string `json:"ref"`
	Text  string `json:"text"`
	Range struct {
		Start int `json:"start"`
		End   int `json:"end"`
		Total int `json:"total"`
	} `json:"range"`
	NextCursor string            `json:"nextCursor,omitempty"`
	Provenance HistoryProvenance `json:"provenance"`
}
type branchSource interface {
	ID() string
	CWD() string
	File() string
	LeafID() string
	Branch(...string) ([]Entry, error)
}
type History struct{ s *Session }

func NewHistory(s *Session) *History { return &History{s: s} }

type historyInput struct {
	Query             string `json:"query"`
	Cursor            string `json:"cursor"`
	Limit             int    `json:"limit"`
	ExcerptChars      int    `json:"excerptChars"`
	Ref               string `json:"ref"`
	MaxChars          int    `json:"maxChars"`
	SessionFile       string `json:"sessionFile"`
	AllowCrossSession bool   `json:"allowCrossSession"`
}
type histCursor struct {
	Kind      string  `json:"kind"`
	SessionID string  `json:"sessionId"`
	LeafID    *string `json:"leafId"`
	Offset    int     `json:"offset"`
	Key       string  `json:"key"`
}

func encodeCursor(c histCursor) string {
	b, _ := json.Marshal(c)
	return cursorPrefix + base64.RawURLEncoding.EncodeToString(b)
}
func decodeCursor(v, kind string) (histCursor, error) {
	var c histCursor
	if v == "" {
		return c, nil
	}
	if len(v) > maxCursorChars || !strings.HasPrefix(v, cursorPrefix) {
		return c, errors.New("invalid history cursor")
	}
	b, e := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(v, cursorPrefix))
	if e != nil {
		return c, errors.New("invalid history cursor")
	}
	if e = json.Unmarshal(b, &c); e != nil || c.Kind != kind || c.SessionID == "" || c.Offset < 0 || c.Key == "" {
		return c, errors.New("invalid history cursor")
	}
	return c, nil
}
func (h *History) Handle(_ context.Context, method string, args json.RawMessage) (any, error) {
	var in historyInput
	if len(args) > 0 {
		if e := json.Unmarshal(args, &in); e != nil {
			return nil, errors.New("history parameters must be an object")
		}
	}
	switch method {
	case "history.search":
		return h.search(in)
	case "history.read":
		return h.read(in)
	default:
		return nil, fmt.Errorf("unknown history method: %s", method)
	}
}
func (h *History) source(in historyInput) (branchSource, string, error) {
	if in.SessionFile == "" {
		return h.s, "active-session-branch", nil
	}
	a, e := filepath.Abs(in.SessionFile)
	if e != nil {
		return nil, "", e
	}
	b, e := filepath.Abs(h.s.File())
	if e == nil && a == b {
		return h.s, "active-session-branch", nil
	}
	if !in.AllowCrossSession {
		return nil, "", errors.New("cross-session history requires allowCrossSession: true")
	}
	if len(in.SessionFile) > 4096 {
		return nil, "", errors.New("sessionFile is too long")
	}
	r, e := OpenReadOnly(in.SessionFile)
	if e != nil {
		return nil, "", e
	}
	return r, "cross-session-branch", nil
}

type historyItem struct {
	text string
	p    HistoryProvenance
	rank int
}

func branchLeaf(s branchSource) *string {
	x := s.LeafID()
	if x == "" {
		return nil
	}
	return &x
}
func exclusions(es []Entry) (map[string]bool, error) {
	out := map[string]bool{}
	n := 0
	for _, e := range es {
		if e.Type != "custom" || e.CustomType != "die-manual-shake" {
			continue
		}
		var d struct {
			ToolResultEntryIDs []string `json:"toolResultEntryIds"`
		}
		if len(e.Data) == 0 || json.Unmarshal(e.Data, &d) != nil || d.ToolResultEntryIDs == nil {
			return nil, errors.New("invalid manual-shake exclusion record")
		}
		for _, id := range d.ToolResultEntryIDs {
			if id == "" {
				return nil, errors.New("invalid manual-shake exclusion record")
			}
			n++
			if n > 100000 {
				return nil, errors.New("history exclusions exceed 100000 ids")
			}
			out[id] = true
		}
	}
	return out, nil
}

type indexedText struct {
	index int
	text  string
}

func entryTextParts(e Entry) []indexedText {
	if len(e.RawMessage) > 0 {
		var raw map[string]any
		if json.Unmarshal(e.RawMessage, &raw) == nil {
			if c, ok := raw["content"].(string); ok && c != "" {
				return []indexedText{{0, c}}
			}
			if a, ok := raw["content"].([]any); ok {
				var out []indexedText
				for i, v := range a {
					if p, ok := v.(map[string]any); ok && p["type"] == "text" {
						if text, ok := p["text"].(string); ok && text != "" {
							out = append(out, indexedText{i, text})
						}
					}
				}
				return out
			}
			if e.Message != nil && e.Message.Role == "bashExecution" && raw["excludeFromContext"] != true {
				var out []indexedText
				if x, ok := raw["command"].(string); ok {
					out = append(out, indexedText{0, x})
				}
				if x, ok := raw["output"].(string); ok {
					out = append(out, indexedText{1, x})
				}
				return out
			}
		}
	}
	if e.Message != nil && e.Message.Content != "" {
		return []indexedText{{0, e.Message.Content}}
	}
	return nil
}
func makeItems(s branchSource, scope string, leaf *string) ([]historyItem, int, bool, error) {
	var es []Entry
	var e error
	if leaf == nil {
		es = []Entry{}
	} else {
		es, e = s.Branch(*leaf)
	}
	if e != nil {
		return nil, 0, false, e
	}
	if len(es) > 100000 {
		return nil, 0, false, errors.New("active history branch exceeds 100000 entries")
	}
	limited := len(es) > 20000
	if limited {
		es = es[len(es)-20000:]
	}
	current, e := s.Branch()
	if e != nil {
		return nil, 0, false, e
	}
	excluded, e := exclusions(current)
	if e != nil {
		return nil, 0, false, e
	}
	items := []historyItem{}
	totalBytes := 0
	for _, x := range es {
		if x.Type != "message" || x.Message == nil || x.Message.Hidden || excluded[x.ID] {
			continue
		}
		role := x.Message.Role
		rank := 9
		switch role {
		case "user":
			rank = 0
		case "assistant":
			rank = 1
		case "bashExecution":
			rank = 2
		case "toolResult", "tool":
			rank = 3
		default:
			continue
		}
		parts := entryTextParts(x)
		lf := leaf
		for _, part := range parts {
			text := part.text
			if len([]byte(text)) > 4<<20 {
				return nil, 0, false, errors.New("history text part exceeds 4 MiB limit")
			}
			totalBytes += len([]byte(text))
			if totalBytes > 64<<20 {
				return nil, 0, false, errors.New("history scan exceeds 64 MiB text limit")
			}
			p := HistoryProvenance{Source: "original-transcript", Scope: scope, SessionID: s.ID(), SessionFile: s.File(), CWD: s.CWD(), BranchLeafID: lf, EntryID: x.ID, Timestamp: x.Timestamp, Role: role, Part: part.index}
			items = append(items, historyItem{text: text, p: p, rank: rank})
		}
	}
	return items, len(es), limited, nil
}
func validCursor(c histCursor, s branchSource, key string) error {
	if c.Kind == "" {
		return nil
	}
	if c.SessionID != s.ID() || c.Key != key {
		return errors.New("history cursor does not match this query, reference, session, or active branch")
	}
	if c.LeafID != nil {
		es, e := s.Branch()
		if e != nil {
			return e
		}
		ok := false
		for _, x := range es {
			if x.ID == *c.LeafID {
				ok = true
				break
			}
		}
		if !ok {
			return errors.New("history cursor does not match this query, reference, session, or active branch")
		}
	}
	return nil
}
func (h *History) search(in historyInput) (HistorySearchResult, error) {
	var out HistorySearchResult
	out.Matches = []HistorySearchMatch{}
	if strings.TrimSpace(in.Query) == "" || len([]rune(in.Query)) > maxQueryChars {
		return out, errors.New("history query must contain 1 to 500 characters")
	}
	if in.Limit == 0 {
		in.Limit = 20
	}
	if in.Limit < 1 || in.Limit > maxSearchResults {
		return out, errors.New("limit must be an integer from 1 to 50")
	}
	if in.ExcerptChars == 0 {
		in.ExcerptChars = 240
	}
	if in.ExcerptChars < 40 || in.ExcerptChars > maxExcerptChars {
		return out, errors.New("excerptChars must be an integer from 40 to 600")
	}
	s, scope, e := h.source(in)
	if e != nil {
		return out, e
	}
	key := in.Query + "\x00" + strconv.Itoa(in.ExcerptChars) + "\x00" + scope + "\x00" + s.File()
	c, e := decodeCursor(in.Cursor, "search")
	if e != nil {
		return out, e
	}
	if e = validCursor(c, s, key); e != nil {
		return out, e
	}
	leaf := branchLeaf(s)
	start := 0
	if c.Kind != "" {
		leaf = c.LeafID
		start = c.Offset
	}
	items, scanned, limited, e := makeItems(s, scope, leaf)
	if e != nil {
		return out, e
	}
	out.ScannedEntries = scanned
	out.ScanLimited = limited
	needle := strings.ToLower(in.Query)
	matches := []HistorySearchMatch{}
	ranks := map[string]int{}
	for _, it := range items {
		at := strings.Index(strings.ToLower(it.text), needle)
		if at < 0 {
			continue
		}
		runes := []rune(it.text)
		charAt := len([]rune(it.text[:at]))
		ex := runes
		prefix, suffix := "", ""
		if len(ex) > in.ExcerptChars {
			begin := charAt - in.ExcerptChars/3
			if begin < 0 {
				begin = 0
			}
			if begin+in.ExcerptChars > len(ex) {
				begin = len(ex) - in.ExcerptChars
			}
			if begin > 0 {
				prefix = "…"
			}
			if begin+in.ExcerptChars < len(ex) {
				suffix = "…"
			}
			ex = ex[begin : begin+in.ExcerptChars]
		}
		ref := fmt.Sprintf("%s:%s:%s:%d", refPrefix, s.ID(), it.p.EntryID, it.p.Part)
		matches = append(matches, HistorySearchMatch{Ref: ref, Excerpt: prefix + string(ex) + suffix, MatchOffset: charAt, TextLength: len(runes), Provenance: it.p})
		ranks[ref] = it.rank
	}
	sort.Slice(matches, func(i, j int) bool {
		ri, rj := ranks[matches[i].Ref], ranks[matches[j].Ref]
		if ri != rj {
			return ri < rj
		}
		if matches[i].Provenance.Timestamp != matches[j].Provenance.Timestamp {
			return matches[i].Provenance.Timestamp > matches[j].Provenance.Timestamp
		}
		return matches[i].Ref < matches[j].Ref
	})
	if start > len(matches) {
		return out, errors.New("invalid history cursor")
	}
	end := start + in.Limit
	if end > len(matches) {
		end = len(matches)
	}
	out.Matches = matches[start:end]
	if end < len(matches) {
		out.NextCursor = encodeCursor(histCursor{Kind: "search", SessionID: s.ID(), LeafID: leaf, Offset: end, Key: key})
	}
	return out, nil
}
func parseRef(v string) (string, string, int, error) {
	if len(v) > 300 {
		return "", "", 0, errors.New("invalid history ref")
	}
	p := strings.Split(v, ":")
	if len(p) != 4 || p[0] != refPrefix || p[1] == "" || p[2] == "" {
		return "", "", 0, errors.New("invalid history ref")
	}
	n, e := strconv.Atoi(p[3])
	if e != nil || n < 0 {
		return "", "", 0, errors.New("invalid history ref")
	}
	return p[1], p[2], n, nil
}
func (h *History) read(in historyInput) (HistoryReadResult, error) {
	var out HistoryReadResult
	if in.MaxChars == 0 {
		in.MaxChars = 8000
	}
	if in.MaxChars < 1 || in.MaxChars > maxReadChars {
		return out, errors.New("maxChars must be an integer from 1 to 16000")
	}
	s, scope, e := h.source(in)
	if e != nil {
		return out, e
	}
	sid, eid, part, e := parseRef(in.Ref)
	if e != nil {
		return out, e
	}
	if sid != s.ID() {
		return out, errors.New("history ref does not match this session")
	}
	key := in.Ref + "\x00" + scope + "\x00" + s.File()
	c, e := decodeCursor(in.Cursor, "read")
	if e != nil {
		return out, e
	}
	if e = validCursor(c, s, key); e != nil {
		return out, e
	}
	leaf := branchLeaf(s)
	start := 0
	if c.Kind != "" {
		leaf = c.LeafID
		start = c.Offset
	}
	items, _, _, e := makeItems(s, scope, leaf)
	if e != nil {
		return out, e
	}
	var found *historyItem
	for i := range items {
		if items[i].p.EntryID == eid && items[i].p.Part == part {
			found = &items[i]
			break
		}
	}
	if found == nil {
		return out, errors.New("history ref is absent from branch or excluded from retrieval")
	}
	rs := []rune(found.text)
	if start > len(rs) {
		return out, errors.New("invalid history cursor")
	}
	end := start + in.MaxChars
	if end > len(rs) {
		end = len(rs)
	}
	out.Ref = in.Ref
	out.Text = string(rs[start:end])
	out.Range.Start = start
	out.Range.End = end
	out.Range.Total = len(rs)
	out.Provenance = found.p
	if end < len(rs) {
		out.NextCursor = encodeCursor(histCursor{Kind: "read", SessionID: s.ID(), LeafID: leaf, Offset: end, Key: key})
	}
	return out, nil
}
