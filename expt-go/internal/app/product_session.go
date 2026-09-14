package app

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"

	"godie/internal/session"
)

// ProductSessionCommand implements non-interactive portions of Pi's session,
// tree, resume-catalog, and export surfaces. The coordinator owns slash routing.
func (a *Application) ProductSessionCommand(name, args string) (string, error) {
	switch name {
	case "/session":
		usage, err := a.Session.CombinedUsage()
		if err != nil {
			return "", err
		}
		branch, err := a.Session.Branch()
		if err != nil {
			return "", err
		}
		v := map[string]any{"path": a.Session.File(), "id": a.Session.ID(), "cwd": a.Session.CWD(), "leafId": a.Session.LeafID(), "entries": len(branch), "usage": usage}
		b, _ := json.MarshalIndent(v, "", "  ")
		return string(b), nil
	case "/tree":
		nodes, err := a.Session.Tree()
		if err != nil {
			return "", err
		}
		b, _ := json.MarshalIndent(nodes, "", "  ")
		return string(b), nil
	case "/resume":
		if strings.TrimSpace(args) != "" {
			return "", errors.New("interactive session switching requires coordinator ownership")
		}
		items, err := session.Catalog(a.Options.SessionDir, a.Options.CWD)
		if err != nil {
			return "", err
		}
		b, _ := json.MarshalIndent(items, "", "  ")
		return string(b), nil
	case "/export":
		target := strings.TrimSpace(args)
		if target == "" {
			target = a.Session.ID() + ".html"
		}
		if filepath.Ext(target) == ".jsonl" {
			p, err := a.Session.ExportJSONL(target)
			if err != nil {
				return "", err
			}
			return "Exported session to " + p, nil
		}
		if filepath.Ext(target) != ".html" {
			return "", errors.New("export path must end in .html or .jsonl")
		}
		p, err := a.Session.ExportHTML(target)
		if err != nil {
			return "", err
		}
		return "Exported session to " + p, nil
	default:
		return "", errors.New("unsupported product session command")
	}
}
