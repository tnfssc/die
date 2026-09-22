# v0.5.6 empty homepage cost fix

User explicitly requested push and release instead of a PR. Starting HEAD 9628eaf on develop, clean. Latest release 0.5.5. Fix 3591aa2 hides native cost summary when both own/subtree turn counts are zero; four focused tests plus web/root typechecks and exact source verification passed.

Release preparation: version 0.5.6, docs/release-v0.5.6.md, include focused UI test in release workflow web tests. Run local checks, push develop and tag, monitor CI using explicit bash (default shell fish). Confirm publication/assets and set release notes, no automatic binary downloads or local install.
