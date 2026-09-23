# Shared memory is part of finishing work

User said no notes checklist or polished abstract words. They want value in same plain voice. Approved text is now in src/prompts/memory.md by existing memory guidance:

> Work not done if next person cannot pick it up. Leave code and wisdom together, where others can get both. Say what finished and what still needs care.

Why: final release notes kept staying local after code/release push. Notes belong with finished work. Old note is not proof user wrote it. Review it.

Added test in tests/memory-extension.test.ts. It checks delivered system prompt has value. Validation: 31 tests across memory extension, prompts, prompt preview/delivery and provider serialization passed. Typecheck, format and diff checks passed. This changes source prompt only. No new release or local binary install. Commit and push prompt, test, and this wisdom together.
