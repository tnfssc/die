Read pending notes. Merge what's useful into project memory.

User constraints (authoritative; preserve exactly):
{{constraints}}

Pending note paths available at launch:
{{paths}}

Work inside {{cwd}}/.agents/notes. Group related notes, merge repeats, keep it short.
Keep .agents/notes/index.md short. Point to deeper notes; add small topic index.md files when useful.

Save notes first. Then write {{receipt}} listing every saved non-hidden Markdown file and its SHA-256 hash, including index.md. Die handles marking pending notes consumed.

JSON format (paths relative to .agents/notes):
{"files":[{"path":"index.md","sha256":"<hash of saved bytes>"}]}
