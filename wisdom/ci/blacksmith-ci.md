# Blacksmith CI request — blocked

User requested switching CI to Blacksmith and another release after v0.3.3. Current source includes shared-memory value commit 8a45421, not yet released.

Research verified https://docs.blacksmith.sh/introduction/quickstart.md explicitly says Blacksmith is limited to GitHub organizations and unavailable for personal repos. GitHub API repos/tnfssc/die reports owner.type User. Blacksmith requires its GitHub App enabled on an organization with repo access. Runner label blacksmith-2vcpu-ubuntu-2404 is supported; blacksmith-4vcpu-ubuntu-2404 has 16GB RAM if needed.

No workflows changed or release tag made. Tentative package bump 0.3.4 was reverted to0.3.3 after confirming blocker. A local 0.3.4 candidate was built/tests passed before discovering blocker; dist is ignored, installed binary untouched. Need user decision: organization destination/setup, or keep current GitHub runners and release prompt change alone. Do not transfer repository without explicit authorization (updater/download URLs also reference tnfssc/die).

Decision: user approved keeping GitHub runners and releasing the prompt change as v0.3.4. Blacksmith migration closed without changes.
