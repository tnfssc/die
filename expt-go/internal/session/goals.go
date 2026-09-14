package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

const goalEntryType = "die-goal"

var goalStatuses = map[string]bool{"active": true, "waiting": true, "blocked": true, "completed": true, "paused": true}

type GoalState struct {
	ID            string   `json:"id"`
	Revision      int      `json:"revision"`
	Objective     string   `json:"objective"`
	Criteria      []string `json:"criteria"`
	Constraints   []string `json:"constraints"`
	Status        string   `json:"status"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
	Progress      []string `json:"progress,omitempty"`
	Evidence      string   `json:"evidence,omitempty"`
	Blocker       string   `json:"blocker,omitempty"`
	PendingJobIDs []string `json:"pendingJobIds,omitempty"`
	PauseReason   string   `json:"pauseReason,omitempty"`
}
type GoalSetInput struct {
	Objective   string   `json:"objective"`
	Criteria    []string `json:"criteria"`
	Constraints []string `json:"constraints"`
}
type GoalUpdateInput struct {
	Status        string   `json:"status"`
	Evidence      string   `json:"evidence,omitempty"`
	Blocker       string   `json:"blocker,omitempty"`
	PendingJobIDs []string `json:"pendingJobIds,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	Progress      string   `json:"progress,omitempty"`
}
type goalRecord struct {
	Version   int        `json:"version"`
	Operation string     `json:"operation"`
	Goal      *GoalState `json:"goal,omitempty"`
	At        string     `json:"at"`
}
type Goals struct{ s *Session }

func NewGoals(s *Session) *Goals { return &Goals{s: s} }
func utf16Length(v string) int {
	n := 0
	for _, r := range v {
		if r > 0xffff {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func validText(v, name string) (string, error) {
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	// JavaScript String.length counts UTF-16 code units, not UTF-8 bytes or
	// Unicode code points. Goal limits are part of the persisted schema.
	if utf16Length(v) > 4000 {
		return "", fmt.Errorf("%s is too long", name)
	}
	return trimmed, nil
}

func validList(v []string, name string, required bool) ([]string, error) {
	// A nil slice represents a missing or JSON null value. The source schema
	// requires an array even when (as for constraints) an empty array is valid.
	if v == nil {
		return nil, fmt.Errorf("%s must be an array of nonempty strings", name)
	}
	if required && len(v) == 0 {
		return nil, fmt.Errorf("%s is required", name)
	}
	if len(v) > 20 {
		return nil, fmt.Errorf("%s has too many items", name)
	}
	out := make([]string, len(v))
	for i, x := range v {
		var err error
		if out[i], err = validText(x, name); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func aggregateGoalText(g GoalState) int {
	total := utf16Length(g.Objective) + utf16Length(g.Evidence) + utf16Length(g.Blocker) + utf16Length(g.PauseReason)
	for _, xs := range [][]string{g.Criteria, g.Constraints, g.Progress, g.PendingJobIDs} {
		for _, x := range xs {
			total += utf16Length(x)
		}
	}
	return total
}

func validGoal(g GoalState) error {
	if !goalStatuses[g.Status] || g.Revision < 1 || g.Revision > 9007199254740991 {
		return errors.New("invalid goal state")
	}
	for _, field := range []struct{ value, name string }{{g.ID, "id"}, {g.Objective, "objective"}, {g.CreatedAt, "createdAt"}, {g.UpdatedAt, "updatedAt"}} {
		if _, err := validText(field.value, field.name); err != nil {
			return err
		}
	}
	if _, err := validList(g.Criteria, "criteria", true); err != nil {
		return err
	}
	if _, err := validList(g.Constraints, "constraints", false); err != nil {
		return err
	}
	if g.Progress != nil {
		if len(g.Progress) > 8 {
			return errors.New("goal has too many progress items")
		}
		progress, err := validList(g.Progress, "progress", false)
		if err != nil {
			return err
		}
		for _, item := range progress {
			if utf16Length(item) > 500 {
				return errors.New("progress evidence is too long")
			}
		}
	}
	switch g.Status {
	case "completed":
		if _, err := validText(g.Evidence, "completion evidence"); err != nil {
			return err
		}
	case "blocked":
		if _, err := validText(g.Blocker, "blocker explanation"); err != nil {
			return err
		}
	case "waiting":
		if _, err := validList(g.PendingJobIDs, "pendingJobIds", true); err != nil {
			return err
		}
	case "paused":
		if _, err := validText(g.PauseReason, "pause reason"); err != nil {
			return err
		}
	}
	if aggregateGoalText(g) > 12000 {
		return errors.New("goal payload is too large")
	}
	return nil
}

func rawString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", false
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	text, ok := value.(string)
	return text, ok
}

func rawList(raw json.RawMessage, name string, required bool) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, fmt.Errorf("%s must be an array of nonempty strings", name)
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil || items == nil {
		return nil, fmt.Errorf("%s must be an array of nonempty strings", name)
	}
	values := make([]string, len(items))
	for i, item := range items {
		value, ok := rawString(item)
		if !ok {
			return nil, fmt.Errorf("%s must be an array of nonempty strings", name)
		}
		values[i] = value
	}
	return validList(values, name, required)
}

func parseGoal(raw json.RawMessage) (*GoalState, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, errors.New("invalid goal state")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, errors.New("invalid goal state")
	}
	stringField := func(name string) (string, error) {
		v, ok := rawString(fields[name])
		if !ok {
			return "", errors.New("invalid goal state")
		}
		return validText(v, name)
	}
	id, err := stringField("id")
	if err != nil {
		return nil, err
	}
	objective, err := stringField("objective")
	if err != nil {
		return nil, err
	}
	createdAt, err := stringField("createdAt")
	if err != nil {
		return nil, err
	}
	updatedAt, err := stringField("updatedAt")
	if err != nil {
		return nil, err
	}
	status, ok := rawString(fields["status"])
	if !ok || !goalStatuses[status] {
		return nil, errors.New("invalid goal state")
	}
	var revisionNumber float64
	if len(fields["revision"]) == 0 || json.Unmarshal(fields["revision"], &revisionNumber) != nil || math.IsNaN(revisionNumber) || math.IsInf(revisionNumber, 0) || math.Trunc(revisionNumber) != revisionNumber || revisionNumber < 1 || revisionNumber > 9007199254740991 {
		return nil, errors.New("invalid goal state")
	}
	criteria, err := rawList(fields["criteria"], "criteria", true)
	if err != nil {
		return nil, err
	}
	constraints, err := rawList(fields["constraints"], "constraints", false)
	if err != nil {
		return nil, err
	}
	goal := &GoalState{ID: id, Revision: int(revisionNumber), Objective: objective, Criteria: criteria, Constraints: constraints, Status: status, CreatedAt: createdAt, UpdatedAt: updatedAt}
	if progressRaw, present := fields["progress"]; present {
		goal.Progress, err = rawList(progressRaw, "progress", false)
		if err != nil {
			return nil, err
		}
		if len(goal.Progress) > 8 {
			return nil, errors.New("goal has too many progress items")
		}
		for _, item := range goal.Progress {
			if utf16Length(item) > 500 {
				return nil, errors.New("progress evidence is too long")
			}
		}
	}
	switch status {
	case "completed":
		goal.Evidence, err = stringField("evidence")
	case "blocked":
		goal.Blocker, err = stringField("blocker")
	case "waiting":
		goal.PendingJobIDs, err = rawList(fields["pendingJobIds"], "pendingJobIds", true)
	case "paused":
		goal.PauseReason, err = stringField("pauseReason")
	}
	if err != nil {
		return nil, err
	}
	if err = validGoal(*goal); err != nil {
		return nil, err
	}
	return goal, nil
}

func (g *Goals) Get() (*GoalState, error) {
	es, err := g.s.Branch()
	if err != nil {
		return nil, err
	}
	var state *GoalState
	for _, entry := range es {
		if entry.Type != "custom" || entry.CustomType != goalEntryType {
			continue
		}
		var fields map[string]json.RawMessage
		if json.Unmarshal(entry.Data, &fields) != nil || fields == nil {
			state = nil
			continue
		}
		var version float64
		operation, operationOK := rawString(fields["operation"])
		_, atOK := rawString(fields["at"])
		if json.Unmarshal(fields["version"], &version) != nil || version != 1 || !operationOK || !atOK || (operation != "clear" && operation != "set" && operation != "update") {
			state = nil
			continue
		}
		if operation == "clear" {
			state = nil
			continue
		}
		candidate, parseErr := parseGoal(fields["goal"])
		if parseErr != nil {
			state = nil
			continue
		}
		if operation == "set" {
			state = candidate
		} else if state != nil && candidate.ID == state.ID && candidate.Revision > state.Revision {
			state = candidate
		} else {
			state = nil
		}
	}
	if state == nil {
		return nil, nil
	}
	b, _ := json.Marshal(state)
	var out GoalState
	_ = json.Unmarshal(b, &out)
	return &out, nil
}
func (g *Goals) save(op string, state *GoalState) (*GoalState, error) {
	at := g.s.cfg.Now().UTC().Format(time.RFC3339Nano)
	if state != nil {
		at = state.UpdatedAt
	}
	_, e := g.s.AppendCustom(goalEntryType, goalRecord{Version: 1, Operation: op, Goal: state, At: at})
	if e != nil {
		return nil, e
	}
	return g.Get()
}
func (g *Goals) Set(in GoalSetInput) (*GoalState, error) {
	g.s.goalMu.Lock()
	defer g.s.goalMu.Unlock()
	obj, e := validText(in.Objective, "objective")
	if e != nil {
		return nil, e
	}
	criteria, e := validList(in.Criteria, "criteria", true)
	if e != nil {
		return nil, e
	}
	constraints, e := validList(in.Constraints, "constraints", false)
	if e != nil {
		return nil, e
	}
	prior, e := g.Get()
	if e != nil {
		return nil, e
	}
	rev := 1
	if prior != nil {
		rev = prior.Revision + 1
	}
	at := g.s.cfg.Now().UTC().Format(time.RFC3339Nano)
	state := &GoalState{ID: g.s.cfg.NewID("goal"), Revision: rev, Objective: obj, Criteria: criteria, Constraints: constraints, Status: "active", CreatedAt: at, UpdatedAt: at}
	if e = validGoal(*state); e != nil {
		return nil, e
	}
	return g.save("set", state)
}
func (g *Goals) Update(in GoalUpdateInput, running ...map[string]bool) (*GoalState, error) {
	g.s.goalMu.Lock()
	defer g.s.goalMu.Unlock()
	state, e := g.Get()
	if e != nil {
		return nil, e
	}
	if state == nil {
		return nil, errors.New("no goal is set")
	}
	if !goalStatuses[in.Status] {
		return nil, errors.New("invalid goal status")
	}
	state.Revision++
	state.Status = in.Status
	state.UpdatedAt = g.s.cfg.Now().UTC().Format(time.RFC3339Nano)
	state.Evidence = ""
	state.Blocker = ""
	state.PendingJobIDs = nil
	state.PauseReason = ""
	switch in.Status {
	case "completed":
		state.Evidence, e = validText(in.Evidence, "completion evidence")
	case "blocked":
		state.Blocker, e = validText(in.Blocker, "blocker explanation")
	case "paused":
		state.PauseReason = in.Reason
		if strings.TrimSpace(state.PauseReason) == "" {
			state.PauseReason = "Paused"
		}
		state.PauseReason, e = validText(state.PauseReason, "pause reason")
	case "waiting":
		state.PendingJobIDs, e = validList(in.PendingJobIDs, "pendingJobIds", true)
		if e == nil && len(running) > 0 {
			for _, id := range state.PendingJobIDs {
				if !running[0][id] {
					return nil, fmt.Errorf("waiting requires running jobs owned by this agent: %s", id)
				}
			}
		}
	}
	if e != nil {
		return nil, e
	}
	if in.Progress != "" {
		if in.Status != "active" {
			return nil, errors.New("progress evidence requires active status")
		}
		p, e := validText(in.Progress, "progress evidence")
		if e != nil {
			return nil, e
		}
		if utf16Length(p) > 500 {
			return nil, errors.New("progress evidence is too long")
		}
		found := false
		for _, x := range state.Progress {
			if x == p {
				found = true
			}
		}
		if !found {
			state.Progress = append(state.Progress, p)
			if len(state.Progress) > 8 {
				state.Progress = state.Progress[len(state.Progress)-8:]
			}
		}
	}
	if e = validGoal(*state); e != nil {
		return nil, e
	}
	return g.save("update", state)
}

// GoalReconcile is the runtime decision after checking jobs for a waiting goal.
type GoalReconcile struct {
	Goal     *GoalState `json:"goal,omitempty"`
	Continue bool       `json:"continue"`
}

// Waiting is runtime-owned and deliberately is not exposed by Handle.
func (g *Goals) Waiting(ids []string) (*GoalState, error) {
	owned := make(map[string]bool, len(ids))
	for _, id := range ids {
		owned[id] = true
	}
	return g.Update(GoalUpdateInput{Status: "waiting", PendingJobIDs: ids}, owned)
}

// Continue activates a goal after waited-for work finishes.
func (g *Goals) Continue() (*GoalState, error) {
	return g.Update(GoalUpdateInput{Status: "active"})
}

// ReconcileRunning uses true for running owned jobs and false for known
// finished jobs. A missing ID is unavailable in this process.
func (g *Goals) ReconcileRunning(jobs map[string]bool) (GoalReconcile, error) {
	goal, err := g.Get()
	if err != nil || goal == nil || goal.Status != "waiting" {
		return GoalReconcile{Goal: goal}, err
	}
	finished := false
	var unavailable []string
	for _, id := range goal.PendingJobIDs {
		running, known := jobs[id]
		if !known {
			unavailable = append(unavailable, id)
		} else if !running {
			finished = true
		}
	}
	if len(unavailable) > 0 {
		reason := "Paused because waiting work is unavailable in this process"
		var refs []string
		for _, id := range unavailable {
			if strings.HasPrefix(id, "task_") && len(id) <= 69 {
				refs = append(refs, id)
			}
		}
		if len(refs) > 0 {
			reason += ". Job references: " + strings.Join(refs, ", ")
		}
		goal, err = g.Update(GoalUpdateInput{Status: "paused", Reason: reason})
		return GoalReconcile{Goal: goal}, err
	}
	if finished {
		goal, err = g.Continue()
		return GoalReconcile{Goal: goal, Continue: err == nil}, err
	}
	return GoalReconcile{Goal: goal}, nil
}

func (g *Goals) Clear() error {
	g.s.goalMu.Lock()
	defer g.s.goalMu.Unlock()
	_, e := g.save("clear", nil)
	return e
}
func decodeObject(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &fields) != nil || fields == nil {
		return nil, errors.New("arguments must be an object")
	}
	return fields, nil
}

func (g *Goals) Handle(_ context.Context, method string, args json.RawMessage) (any, error) {
	switch method {
	case "goal.get":
		return g.Get()
	case "goal.set":
		fields, err := decodeObject(args)
		if err != nil {
			return nil, err
		}
		objective, ok := rawString(fields["objective"])
		if !ok {
			return nil, errors.New("objective is required")
		}
		criteria, err := rawList(fields["criteria"], "criteria", true)
		if err != nil {
			return nil, err
		}
		constraints, err := rawList(fields["constraints"], "constraints", false)
		if err != nil {
			return nil, err
		}
		return g.Set(GoalSetInput{Objective: objective, Criteria: criteria, Constraints: constraints})
	case "goal.update":
		fields, err := decodeObject(args)
		if err != nil {
			return nil, err
		}
		if _, present := fields["pendingJobIds"]; present {
			return nil, errors.New("goal.update pendingJobIds is runtime-managed; use handoff() to wait for owned running jobs")
		}
		status, ok := rawString(fields["status"])
		if !ok || !goalStatuses[status] {
			return nil, errors.New("invalid goal status")
		}
		if status == "waiting" {
			return nil, errors.New("goal.update waiting status is runtime-managed; use handoff() to wait for owned running jobs")
		}
		in := GoalUpdateInput{Status: status}
		switch status {
		case "completed":
			in.Evidence, ok = rawString(fields["evidence"])
			if !ok {
				return nil, errors.New("completion evidence is required")
			}
		case "blocked":
			in.Blocker, ok = rawString(fields["blocker"])
			if !ok {
				return nil, errors.New("blocker explanation is required")
			}
		case "paused":
			if raw, present := fields["reason"]; present {
				in.Reason, ok = rawString(raw)
				if !ok {
					return nil, errors.New("pause reason is required")
				}
				if _, err = validText(in.Reason, "pause reason"); err != nil {
					return nil, err
				}
			}
		}
		if raw, present := fields["progress"]; present {
			in.Progress, ok = rawString(raw)
			if !ok {
				return nil, errors.New("progress evidence is required")
			}
			if _, err = validText(in.Progress, "progress evidence"); err != nil {
				return nil, err
			}
		}
		return g.Update(in)
	case "goal.clear":
		if err := g.Clear(); err != nil {
			return nil, err
		}
		return map[string]bool{"cleared": true}, nil
	default:
		return nil, fmt.Errorf("unknown goal method: %s", method)
	}
}
func formatGoal(x *GoalState) string {
	if x == nil {
		return "No goal is set."
	}
	return fmt.Sprintf("Goal: %s\nStatus: %s\nCriteria: %s\nConstraints: %s", x.Objective, x.Status, strings.Join(x.Criteria, "; "), func() string {
		if len(x.Constraints) == 0 {
			return "none"
		}
		return strings.Join(x.Constraints, "; ")
	}())
}
func (g *Goals) Slash(args string) (string, error) {
	parts := strings.Fields(strings.TrimSpace(args))
	if len(parts) == 0 {
		parts = []string{"status"}
	}
	cmd := parts[0]
	rest := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(args), cmd))
	switch cmd {
	case "status":
		x, e := g.Get()
		return formatGoal(x), e
	case "clear":
		return "No goal is set.", g.Clear()
	case "pause":
		x, e := g.Update(GoalUpdateInput{Status: "paused", Reason: rest})
		return formatGoal(x), e
	case "resume":
		x, e := g.Update(GoalUpdateInput{Status: "active"})
		return formatGoal(x), e
	case "set":
		ci := strings.Index(rest, "--criteria")
		co := strings.Index(rest, "--constraints")
		if ci < 0 {
			return "", errors.New("usage: /goal set <objective> --criteria <criterion[;...]> --constraints <constraint[;...]>")
		}
		obj := strings.TrimSpace(rest[:ci])
		var cr, cs string
		if co > ci {
			cr = strings.TrimSpace(rest[ci+10 : co])
			cs = strings.TrimSpace(rest[co+13:])
		} else {
			cr = strings.TrimSpace(rest[ci+10:])
		}
		split := func(v string) []string {
			o := []string{}
			for _, x := range strings.Split(v, ";") {
				if strings.TrimSpace(x) != "" {
					o = append(o, strings.TrimSpace(x))
				}
			}
			return o
		}
		x, e := g.Set(GoalSetInput{Objective: obj, Criteria: split(cr), Constraints: split(cs)})
		return formatGoal(x), e
	default:
		return "", errors.New("usage: /goal set|status|pause|resume|clear")
	}
}
