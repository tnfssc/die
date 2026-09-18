# Shared memory is part of finishing work

User rejected a notes-pushing checklist and polished abstract wording. They want values-based prompting in the existing plain voice. Approved text now in src/prompts/memory.md beside the existing memory guidance:

> Work not done if next person cannot pick it up. Leave code and notes together, where others can get both. Say what finished and what still needs care.

Reason: final release notes were repeatedly left local after code/release was pushed. Notes belong with completed work; do not assume an existing note edit was user-authored merely because it predates the current session. Review it.

Added assertion in tests/memory-extension.test.ts verifying delivered system prompt contains the value. Validation: 31 tests across memory extension, prompts, prompt preview/delivery and provider serialization passed; typecheck, format and diff checks passed. This is a source prompt change only, not a new release or local binary installation. Commit and push prompt, test, and these notes together.
