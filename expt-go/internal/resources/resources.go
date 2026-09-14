// Package resources discovers and expands Markdown skills and prompt templates.
package resources

import (
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const maxFileSize = 1 << 20
const maxFiles = 4096

type Skill struct {
	Name, Description, Path, BaseDir string
	DisableModelInvocation           bool
}
type Template struct{ Name, Description, ArgumentHint, Content, Path string }
type Set struct {
	Skills    []Skill
	Templates []Template
	Warnings  []string
}
type Options struct {
	CWD, StateDir                                   string
	IncludeProject, IncludeSkills, IncludeTemplates bool
	SkillPaths, TemplatePaths                       []string
}

func Discover(o Options) Set {
	var out Set
	seenSkill := map[string]string{}
	seenFile := map[string]bool{}
	addSkill := func(s Skill, warns []string) {
		out.Warnings = append(out.Warnings, warns...)
		real, _ := filepath.EvalSymlinks(s.Path)
		if real == "" {
			real = s.Path
		}
		if seenFile[real] {
			return
		}
		if old, ok := seenSkill[s.Name]; ok {
			out.Warnings = append(out.Warnings, fmt.Sprintf("skill %q from %s ignored; name already loaded from %s", s.Name, s.Path, old))
			return
		}
		seenFile[real] = true
		seenSkill[s.Name] = s.Path
		out.Skills = append(out.Skills, s)
	}
	if o.IncludeSkills {
		scanSkillDir(filepath.Join(o.StateDir, "skills"), true, addSkill, &out.Warnings)
		if home, e := os.UserHomeDir(); e == nil {
			scanSkillDir(filepath.Join(home, ".agents", "skills"), false, addSkill, &out.Warnings)
		}
		if o.IncludeProject {
			scanSkillDir(filepath.Join(o.CWD, ".pi", "skills"), true, addSkill, &out.Warnings)
			for _, d := range ancestorDirs(o.CWD) {
				scanSkillDir(filepath.Join(d, ".agents", "skills"), false, addSkill, &out.Warnings)
			}
		}
	}
	for _, p := range o.SkillPaths {
		p = resolve(p, o.CWD)
		st, e := os.Stat(p)
		if e != nil {
			out.Warnings = append(out.Warnings, fmt.Sprintf("skill path %s: %v", p, e))
			continue
		}
		if st.IsDir() {
			scanSkillDir(p, true, addSkill, &out.Warnings)
		} else if strings.EqualFold(filepath.Ext(p), ".md") {
			if s, w, ok := loadSkill(p); ok {
				addSkill(s, w)
			} else {
				out.Warnings = append(out.Warnings, w...)
			}
		}
	}
	if o.IncludeTemplates {
		loadTemplateDir(filepath.Join(o.StateDir, "prompts"), &out)
		if o.IncludeProject {
			loadTemplateDir(filepath.Join(o.CWD, ".pi", "prompts"), &out)
		}
	}
	for _, p := range o.TemplatePaths {
		p = resolve(p, o.CWD)
		st, e := os.Stat(p)
		if e != nil {
			out.Warnings = append(out.Warnings, fmt.Sprintf("prompt template path %s: %v", p, e))
			continue
		}
		if st.IsDir() {
			loadTemplateDir(p, &out)
		} else {
			loadTemplateFile(p, &out)
		}
	}
	return out
}
func resolve(p, cwd string) string {
	p = strings.TrimSpace(p)
	if p == "~" || strings.HasPrefix(p, "~/") {
		if h, e := os.UserHomeDir(); e == nil {
			p = filepath.Join(h, strings.TrimPrefix(p, "~/"))
		}
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(cwd, p)
	}
	p, _ = filepath.Abs(p)
	return p
}
func ancestorDirs(cwd string) []string {
	var rev []string
	d := filepath.Clean(cwd)
	for {
		rev = append(rev, d)
		if _, e := os.Stat(filepath.Join(d, ".git")); e == nil {
			break
		}
		p := filepath.Dir(d)
		if p == d {
			break
		}
		d = p
	}
	out := make([]string, len(rev))
	for i := range rev {
		out[len(rev)-1-i] = rev[i]
	}
	return out
}
func readBounded(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, maxFileSize+1))
	if e != nil {
		return "", e
	}
	if len(b) > maxFileSize {
		return "", fmt.Errorf("file exceeds 1 MiB limit")
	}
	return string(b), nil
}

// parseFrontmatter parses the YAML frontmatter subset used by Agent Skills. Quoted
// scalars, booleans and literal/folded multiline scalar values are supported.
func parseFrontmatter(raw string) (map[string]any, string, error) {
	m := map[string]any{}
	raw = strings.TrimPrefix(raw, "\ufeff")
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return m, raw, nil
	}
	end := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			end = i
			break
		}
	}
	if end < 0 {
		return nil, "", fmt.Errorf("unterminated YAML frontmatter")
	}
	for i := 1; i < end; i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "" || strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		k, v, ok := strings.Cut(line, ":")
		if !ok || strings.TrimSpace(k) == "" || strings.HasPrefix(line, " ") {
			return nil, "", fmt.Errorf("invalid frontmatter line %d", i+1)
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if v == "|" || v == ">" {
			var parts []string
			for i+1 < end {
				n := lines[i+1]
				if strings.TrimSpace(n) == "" {
					parts = append(parts, "")
					i++
					continue
				}
				if n[0] != ' ' && n[0] != '\t' {
					break
				}
				parts = append(parts, strings.TrimSpace(n))
				i++
			}
			sep := "\n"
			if v == ">" {
				sep = " "
			}
			m[k] = strings.Join(parts, sep)
			continue
		}
		if v == "true" {
			m[k] = true
		} else if v == "false" {
			m[k] = false
		} else {
			if len(v) >= 2 && ((v[0] == '"' && v[len(v)-1] == '"') || (v[0] == '\'' && v[len(v)-1] == '\'')) {
				if v[0] == '"' {
					if q, e := strconv.Unquote(v); e == nil {
						v = q
					}
				} else {
					v = strings.ReplaceAll(v[1:len(v)-1], "''", "'")
				}
			}
			m[k] = v
		}
	}
	return m, strings.Join(lines[end+1:], "\n"), nil
}

func scanSkillDir(root string, includeRootMD bool, add func(Skill, []string), warnings *[]string) {
	count := 0
	seenDirs := map[string]bool{}
	var walk func(string, bool)
	walk = func(dir string, rootLevel bool) {
		real, err := filepath.EvalSymlinks(dir)
		if err == nil {
			if seenDirs[real] {
				return
			}
			seenDirs[real] = true
		}
		if count >= maxFiles {
			return
		}
		entries, e := os.ReadDir(dir)
		if os.IsNotExist(e) {
			return
		}
		if e != nil {
			*warnings = append(*warnings, fmt.Sprintf("scan skills %s: %v", dir, e))
			return
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
		for _, ent := range entries {
			if ent.Name() == "SKILL.md" {
				p := filepath.Join(dir, ent.Name())
				if s, w, ok := loadSkill(p); ok {
					add(s, w)
				} else {
					*warnings = append(*warnings, w...)
				}
				return
			}
		}
		for _, ent := range entries {
			if count >= maxFiles {
				*warnings = append(*warnings, fmt.Sprintf("skill scan %s stopped after %d entries", root, maxFiles))
				return
			}
			n := ent.Name()
			if strings.HasPrefix(n, ".") || n == "node_modules" {
				continue
			}
			p := filepath.Join(dir, n)
			info, e := ent.Info()
			if e != nil {
				continue
			}
			count++
			if info.IsDir() {
				walk(p, false)
			} else if (rootLevel && includeRootMD || !rootLevel) && strings.EqualFold(filepath.Ext(n), ".md") {
				if s, w, ok := loadSkill(p); ok {
					add(s, w)
				} else {
					*warnings = append(*warnings, w...)
				}
			}
		}
	}
	walk(root, true)
}
func loadSkill(path string) (Skill, []string, bool) {
	raw, e := readBounded(path)
	if e != nil {
		return Skill{}, []string{fmt.Sprintf("skill %s: %v", path, e)}, false
	}
	fm, _, e := parseFrontmatter(raw)
	declared := filepath.Base(path) == "SKILL.md"
	if e != nil {
		if declared {
			return Skill{}, []string{fmt.Sprintf("skill %s: %v", path, e)}, false
		}
		return Skill{}, nil, false
	}
	desc, _ := fm["description"].(string)
	desc = strings.TrimSpace(desc)
	if desc == "" {
		if declared {
			return Skill{}, []string{fmt.Sprintf("skill %s: description is required", path)}, false
		}
		return Skill{}, nil, false
	}
	name, _ := fm["name"].(string)
	if name == "" {
		name = filepath.Base(filepath.Dir(path))
	}
	var w []string
	if len(name) > 64 || !regexp.MustCompile(`^[a-z0-9-]+$`).MatchString(name) || strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") || strings.Contains(name, "--") {
		w = append(w, fmt.Sprintf("skill %s: name %q does not meet Agent Skills naming rules", path, name))
	}
	if len(desc) > 1024 {
		w = append(w, fmt.Sprintf("skill %s: description exceeds 1024 characters", path))
	}
	disabled, _ := fm["disable-model-invocation"].(bool)
	abs, _ := filepath.Abs(path)
	return Skill{Name: name, Description: desc, Path: abs, BaseDir: filepath.Dir(abs), DisableModelInvocation: disabled}, w, true
}
func loadTemplateDir(dir string, out *Set) {
	entries, e := os.ReadDir(dir)
	if os.IsNotExist(e) {
		return
	}
	if e != nil {
		out.Warnings = append(out.Warnings, fmt.Sprintf("scan prompt templates %s: %v", dir, e))
		return
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".md") {
			continue
		}
		loadTemplateFile(filepath.Join(dir, ent.Name()), out)
	}
}
func loadTemplateFile(path string, out *Set) {
	if !strings.HasSuffix(path, ".md") {
		out.Warnings = append(out.Warnings, fmt.Sprintf("prompt template is not Markdown: %s", path))
		return
	}
	raw, e := readBounded(path)
	if e != nil {
		out.Warnings = append(out.Warnings, fmt.Sprintf("prompt template %s: %v", path, e))
		return
	}
	fm, body, e := parseFrontmatter(raw)
	if e != nil {
		out.Warnings = append(out.Warnings, fmt.Sprintf("prompt template %s: %v", path, e))
		return
	}
	name := strings.TrimSuffix(filepath.Base(path), ".md")
	desc, _ := fm["description"].(string)
	if desc == "" {
		for _, line := range strings.Split(body, "\n") {
			if strings.TrimSpace(line) != "" {
				desc = line
				if len(desc) > 60 {
					desc = desc[:60] + "..."
				}
				break
			}
		}
	}
	hint, _ := fm["argument-hint"].(string)
	out.Templates = append(out.Templates, Template{Name: name, Description: desc, ArgumentHint: hint, Content: body, Path: path})
}

func (s Set) FormatSkills() string {
	var b strings.Builder
	visible := 0
	for _, x := range s.Skills {
		if !x.DisableModelInvocation {
			visible++
		}
	}
	if visible == 0 {
		return ""
	}
	b.WriteString("\n\nThe following skills provide specialized instructions for specific tasks.\nUse execute to read a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory and use that absolute path in tool commands.\n\n<available_skills>\n")
	for _, x := range s.Skills {
		if x.DisableModelInvocation {
			continue
		}
		fmt.Fprintf(&b, "  <skill>\n    <name>%s</name>\n    <description>%s</description>\n    <location>%s</location>\n  </skill>\n", xmlEscape(x.Name), xmlEscape(x.Description), xmlEscape(x.Path))
	}
	b.WriteString("</available_skills>")
	return b.String()
}
func xmlEscape(v string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(v))
	return b.String()
}

func (s Set) Expand(text string) (string, bool, error) {
	if strings.HasPrefix(text, "/skill:") {
		space := strings.IndexAny(text, " \t\r\n")
		name := strings.TrimPrefix(text, "/skill:")
		args := ""
		if space >= 0 {
			name = strings.TrimPrefix(text[:space], "/skill:")
			args = strings.TrimSpace(text[space:])
		}
		for _, x := range s.Skills {
			if x.Name == name {
				raw, e := readBounded(x.Path)
				if e != nil {
					return text, false, fmt.Errorf("expand skill %s: %w", name, e)
				}
				_, body, e := parseFrontmatter(raw)
				if e != nil {
					return text, false, e
				}
				block := fmt.Sprintf("<skill name=\"%s\" location=\"%s\">\nReferences are relative to %s.\n\n%s\n</skill>", xmlEscape(x.Name), xmlEscape(x.Path), x.BaseDir, strings.TrimSpace(body))
				if args != "" {
					block += "\n\n" + args
				}
				return block, true, nil
			}
		}
	}
	if !strings.HasPrefix(text, "/") {
		return text, false, nil
	}
	nameArgs := strings.TrimPrefix(text, "/")
	name, args := nameArgs, ""
	if i := strings.IndexAny(nameArgs, " \t\r\n"); i >= 0 {
		name, args = nameArgs[:i], nameArgs[i+1:]
	}
	for _, t := range s.Templates {
		if t.Name == name {
			return Substitute(t.Content, ParseArgs(args)), true, nil
		}
	}
	return text, false, nil
}
func ParseArgs(v string) []string {
	var out []string
	var b strings.Builder
	var quote rune
	for _, r := range v {
		if quote != 0 {
			if r == quote {
				quote = 0
			} else {
				b.WriteRune(r)
			}
		} else if r == '"' || r == '\'' {
			quote = r
		} else if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if b.Len() > 0 {
				out = append(out, b.String())
				b.Reset()
			}
		} else {
			b.WriteRune(r)
		}
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}

var substRE = regexp.MustCompile(`\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)`)

func Substitute(content string, args []string) string {
	all := strings.Join(args, " ")
	return substRE.ReplaceAllStringFunc(content, func(m string) string {
		sub := substRE.FindStringSubmatch(m)
		if sub[1] != "" {
			v := all
			if sub[1] != "@" && sub[1] != "ARGUMENTS" {
				n, _ := strconv.Atoi(sub[1])
				v = ""
				if n > 0 && n <= len(args) {
					v = args[n-1]
				}
			}
			if v == "" {
				return sub[2]
			}
			return v
		}
		if sub[3] != "" {
			n, _ := strconv.Atoi(sub[3])
			if n < 1 {
				n = 1
			}
			start := n - 1
			end := len(args)
			if sub[4] != "" {
				ln, _ := strconv.Atoi(sub[4])
				end = start + ln
				if end > len(args) {
					end = len(args)
				}
			}
			if start >= len(args) {
				return ""
			}
			return strings.Join(args[start:end], " ")
		}
		key := sub[5]
		if key == "@" || key == "ARGUMENTS" {
			return all
		}
		n, _ := strconv.Atoi(key)
		if n > 0 && n <= len(args) {
			return args[n-1]
		}
		return ""
	})
}
