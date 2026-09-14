package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Profile struct {
	Model    string `json:"model,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}
type Profiles map[string]Profile

func LoadProfiles(stateDir string) (Profiles, error) {
	p := Profiles{"fast": {}, "normal": {}, "orchestrator": {}}
	b, err := os.ReadFile(filepath.Join(stateDir, "subagents.json"))
	if os.IsNotExist(err) {
		return p, nil
	}
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&p); err != nil {
		return nil, fmt.Errorf("invalid subagent profiles: %w", err)
	}
	for k, v := range p {
		if k != "fast" && k != "normal" && k != "orchestrator" {
			return nil, fmt.Errorf("invalid profile %q", k)
		}
		if v.Model != "" && (strings.TrimSpace(v.Model) != v.Model || !strings.Contains(v.Model, "/") || strings.HasPrefix(v.Model, "/") || strings.HasSuffix(v.Model, "/") || strings.ContainsAny(v.Model, " \t\n")) {
			return nil, errors.New("profile model must be provider/model")
		}
		if v.Thinking != "" && !strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+v.Thinking+"|") {
			return nil, fmt.Errorf("invalid thinking %q", v.Thinking)
		}
	}
	return p, nil
}
func CanDelegate(depth int, role, child string) error {
	if child != "fast" && child != "normal" && child != "orchestrator" {
		return fmt.Errorf("invalid subagent type %q", child)
	}
	if depth >= 2 || (depth > 0 && role != "orchestrator") {
		return errors.New("fast/normal workers cannot delegate")
	}
	if depth > 0 && child == "orchestrator" {
		return errors.New("spawned orchestrators may only delegate to fast/normal workers")
	}
	return nil
}

// SaveProfiles validates before atomically replacing only Godie's profile file.
func SaveProfiles(stateDir string, p Profiles) error {
	for k, v := range p {
		if k != "fast" && k != "normal" && k != "orchestrator" {
			return fmt.Errorf("invalid profile %q", k)
		}
		if v.Model != "" && (strings.TrimSpace(v.Model) != v.Model || !strings.Contains(v.Model, "/") || strings.HasPrefix(v.Model, "/") || strings.HasSuffix(v.Model, "/") || strings.ContainsAny(v.Model, " \t\n")) {
			return errors.New("profile model must be provider/model")
		}
		if v.Thinking != "" && !strings.Contains("|off|minimal|low|medium|high|xhigh|max|", "|"+v.Thinking+"|") {
			return errors.New("invalid thinking level")
		}
	}
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(stateDir, ".subagents-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(append(b, '\n'))
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(stateDir, "subagents.json"))
}
