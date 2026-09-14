package app

import (
	"embed"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

//go:embed prompts/*.md
var promptFiles embed.FS

func prompt(name string) string {
	b, _ := promptFiles.ReadFile("prompts/" + name + ".md")
	return strings.TrimSpace(string(b))
}

type PromptOptions struct{ NoContextFiles, IgnoreProject bool }

func SystemPrompt(cwd, stateDir, custom, appendText, role string, depth int, flags ...PromptOptions) (string, error) {
	var opts PromptOptions
	if len(flags) > 0 {
		opts = flags[0]
	}
	base := custom
	if custom != "" {
		if st, e := os.Stat(custom); e == nil && st.Mode().IsRegular() {
			b, e := readPromptFile(custom)
			if e != nil {
				return "", e
			}
			base = string(b)
		}
	}
	if base == "" {
		paths := []string{filepath.Join(stateDir, "SYSTEM.md")}
		if !opts.IgnoreProject {
			paths = append([]string{filepath.Join(cwd, ".godie", "SYSTEM.md"), filepath.Join(cwd, ".die", "SYSTEM.md")}, paths...)
		}
		for _, path := range paths {
			b, err := readPromptFile(path)
			if err == nil {
				base = string(b)
				break
			}
			if !os.IsNotExist(err) {
				return "", err
			}
		}
	}
	if base == "" {
		base = prompt("identity") + "\n\nGuidelines:\n" + prompt("execute")
	}
	base += "\n\nCurrent working directory: " + cwd
	if !opts.NoContextFiles {
		paths := []string{stateDir}
		if !opts.IgnoreProject {
			dirs := []string{}
			dir := filepath.Clean(cwd)
			for {
				dirs = append([]string{dir}, dirs...)
				parent := filepath.Dir(dir)
				if parent == dir {
					break
				}
				dir = parent
			}
			paths = append(paths, dirs...)
		}
		seen := map[string]bool{}
		for _, dir := range paths {
			for _, name := range []string{"AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"} {
				path := filepath.Join(dir, name)
				b, err := readPromptFile(path)
				if os.IsNotExist(err) {
					continue
				}
				if err != nil {
					return "", err
				}
				canonical, e := filepath.EvalSymlinks(path)
				if e != nil {
					canonical = path
				}
				if !seen[canonical] {
					base += "\n\n# Project instructions (" + path + ")\n" + string(b)
					seen[canonical] = true
				}
				break
			}
		}
	}
	if appendText != "" {
		base += "\n\n" + appendText
	}
	base += "\n\n" + prompt("system")
	if depth > 0 {
		if role == "" {
			role = "normal"
		}
		base += "\n\n" + strings.ReplaceAll(prompt(role), "{{role}}", role) + fmt.Sprintf("\nYou are a %s sub-agent at depth %d. Delegation restrictions are enforced by the runtime.", role, depth)
	}
	return base, nil
}

// Context is bounded independently of the provider request size.
func readPromptFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	const limit = 1 << 20
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	if len(b) > limit {
		return nil, fmt.Errorf("instruction file exceeds 1 MiB: %s", path)
	}
	return b, nil
}

func promptArgument(text string) (string, error) {
	if st, e := os.Stat(text); e == nil && st.Mode().IsRegular() {
		b, e := readPromptFile(text)
		return string(b), e
	}
	return text, nil
}
