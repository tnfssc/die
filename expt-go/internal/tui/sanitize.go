package tui

import (
	"strings"
	"unicode/utf8"
)

// sanitize removes terminal escape sequences and non-printing controls from
// backend-provided text. Newlines are retained and tabs become four spaces.
func sanitize(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		c := s[i]
		if c == 0x1b {
			i = skipEscape(s, i+1)
			continue
		}
		if c == '\n' {
			b.WriteByte(c)
			i++
			continue
		}
		if c == '\t' {
			b.WriteString("    ")
			i++
			continue
		}
		if c < 0x20 || c == 0x7f {
			i++
			continue
		}
		r, n := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && n == 1 {
			i++
			continue
		}
		if (r >= 0x80 && r <= 0x9f) || r == 0x2028 || r == 0x2029 || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) {
			i += n
			continue
		}
		b.WriteRune(r)
		i += n
	}
	return b.String()
}

func skipEscape(s string, i int) int {
	if i >= len(s) {
		return i
	}
	switch s[i] {
	case '[':
		i++
		for i < len(s) {
			c := s[i]
			i++
			if c >= 0x40 && c <= 0x7e {
				break
			}
		}
		return i
	case ']', 'P', 'X', '^', '_':
		i++
		for i < len(s) {
			if s[i] == 0x07 {
				return i + 1
			}
			if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '\\' {
				return i + 2
			}
			i++
		}
		return i
	default:
		return i + 1
	}
}

func sanitizeMessages(in []Message) []Message {
	out := make([]Message, len(in))
	for i, m := range in {
		m.Text = sanitize(m.Text)
		m.Detail = sanitize(m.Detail)
		out[i] = m
	}
	return out
}

func sanitizeStrings(in []string) []string {
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = sanitize(s)
	}
	return out
}
