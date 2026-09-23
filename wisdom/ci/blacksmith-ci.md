# Blacksmith CI request — blocked

The user asked to move CI to Blacksmith and make another release after v0.3.3. The source had the unreleased shared-memory change from commit 8a45421.

Research confirmed that [Blacksmith's quickstart](https://docs.blacksmith.sh/introduction/quickstart.md) says the service works only for GitHub organizations, not personal repos. The GitHub API for `repos/tnfssc/die` reports `owner.type` as `User`. Blacksmith needs its GitHub App enabled on an organization that can access the repo. `blacksmith-2vcpu-ubuntu-2404` is a supported runner label. `blacksmith-4vcpu-ubuntu-2404` has 16 GB of RAM if needed.

No workflow changed and no release tag was made at that point. The tentative package bump to 0.3.4 was put back to 0.3.3 after the blocker was found. A local 0.3.4 candidate had already built and passed tests. `dist` is ignored, and the installed binary was not touched. The open choice was to set up an organization destination or keep GitHub runners and release only the prompt change. Moving the repo needed clear approval because updater and download URLs also point to `tnfssc/die`.

The user chose to keep GitHub runners and release the prompt change as v0.3.4. The Blacksmith move ended with no changes.
