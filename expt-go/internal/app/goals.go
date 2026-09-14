package app

import (
	"context"
	"encoding/json"
	"godie/internal/core"
	run "godie/internal/runtime"
	"godie/internal/session"
)

func (a *Application) jobStates() map[string]bool {
	v, err := a.Runtime.Call(context.Background(), "jobs.list", mustJSON(map[string]any{"count": 100}))
	if err != nil {
		return map[string]bool{}
	}
	raw, _ := json.Marshal(v)
	var list struct {
		Jobs []run.Job `json:"jobs"`
	}
	_ = json.Unmarshal(raw, &list)
	out := map[string]bool{}
	for _, j := range list.Jobs {
		out[j.ID] = j.Status == "running"
	}
	return out
}
func (a *Application) goalContext(req *core.Request) error {
	if _, err := a.Goals.ReconcileRunning(a.jobStates()); err != nil {
		return err
	}
	g, err := a.Goals.Get()
	if err != nil || g == nil {
		return err
	}
	raw, _ := json.Marshal(g)
	req.Messages = append(req.Messages, core.Message{Role: "user", Hidden: true, Content: "Goal guidance:\n" + prompt("goal") + "\n\nPersistent goal state (authoritative):\n" + string(raw)})
	return nil
}
func (a *Application) observeGoal(emit func(core.StreamEvent)) func(core.StreamEvent) {
	return func(e core.StreamEvent) {
		if e.Type == "handoff" {
			if g, err := a.Goals.Get(); err == nil && g != nil && g.Status == "active" {
				ids := []string{}
				for id, running := range a.jobStates() {
					if running {
						ids = append(ids, id)
					}
				}
				if len(ids) > 0 {
					_, _ = a.Goals.Waiting(ids)
				}
			}
		}
		if a.Observer != nil {
			a.Observer(e)
		}
		if emit != nil {
			emit(e)
		}
	}
}
func (a *Application) runTurn(ctx context.Context, text string, hidden bool, emit func(core.StreamEvent)) error {
	automatic := hidden
	for {
		var err error
		if hidden {
			err = a.Engine.TurnHidden(ctx, text, a.observeGoal(emit))
		} else {
			err = a.Engine.Turn(ctx, text, a.observeGoal(emit))
		}
		if err != nil {
			if g, _ := a.Goals.Get(); g != nil && (g.Status == "active" || g.Status == "waiting") {
				_, _ = a.Goals.Update(session.GoalUpdateInput{Status: "paused", Reason: "Paused after interrupted agent turn"})
			}
			return err
		}
		g, err := a.Goals.Get()
		if err != nil {
			return err
		}
		if g == nil || g.Status != "active" {
			return nil
		}
		milestone, _ := json.Marshal(struct {
			ID       string
			Progress []string
		}{g.ID, g.Progress})
		a.goalMu.Lock()
		if automatic {
			if a.goalMilestone == string(milestone) {
				a.goalNoProgress++
			} else {
				a.goalNoProgress = 0
			}
		} else {
			a.goalNoProgress = 0
		}
		a.goalMilestone = string(milestone)
		pause := a.goalNoProgress >= 3
		a.goalMu.Unlock()
		if pause {
			_, err = a.Goals.Update(session.GoalUpdateInput{Status: "paused", Reason: "Paused after repeated automatic turns made no meaningful progress"})
			if emit != nil {
				emit(core.StreamEvent{Type: "notice", Text: "Goal paused: repeated continuations made no meaningful progress"})
			}
			return err
		}
		automatic = true
		hidden = true
		text = prompt("goal-continuation")
	}
}

func (a *Application) Queue(text string, followUp bool) bool {
	if !a.Engine.Enqueue(text, followUp) {
		return false
	}
	if g, _ := a.Goals.Get(); g != nil && (g.Status == "active" || g.Status == "waiting") {
		_, _ = a.Goals.Update(session.GoalUpdateInput{Status: "paused", Reason: "Paused by user interruption"})
	}
	return true
}
