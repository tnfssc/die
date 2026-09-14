package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Startup defaults are read only; session policies never rewrite user settings.
func loadStartupSettings(o *Options) error {
	var defaults struct {
		Provider string `json:"defaultProvider"`
		Model    string `json:"defaultModel"`
		Thinking string `json:"defaultThinkingLevel"`
	}
	paths := []string{filepath.Join(o.StateDir, "settings.json")}
	if !o.IgnoreProject {
		paths = append(paths, filepath.Join(o.CWD, ".die", "settings.json"), filepath.Join(o.CWD, ".godie", "settings.json"))
	}
	for _, p := range paths {
		b, e := readPromptFile(p)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return e
		}
		if e = json.Unmarshal(b, &defaults); e != nil {
			return fmt.Errorf("settings: %s: invalid JSON", p)
		}
	}
	if o.Provider == "" {
		o.Provider = defaults.Provider
	}
	if o.Model == "" {
		o.Model = defaults.Model
	}
	if !o.ThinkingSet && (o.Thinking == "" || o.Thinking == "medium") && defaults.Thinking != "" {
		o.Thinking = defaults.Thinking
	}
	if o.Thinking != "" && !strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+o.Thinking+"|") {
		return fmt.Errorf("settings: invalid default thinking level")
	}
	return nil
}
