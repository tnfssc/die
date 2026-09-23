# Curated license inputs

The release notice generator copies LICENSE, COPYING, and NOTICE files directly
from installed production packages. The files here cover runtime material whose
published npm package does not carry its own license file, plus the compiled
runtime itself:

- pi/LICENSE: earendil-works/pi v0.87.1 root LICENSE.
- bun/LICENSE.md: oven-sh/bun bun-v1.4.1 LICENSE.md, including linked libraries.
- npm/aws-sdk-js-v3.LICENSE: aws/aws-sdk-js-v3 root Apache-2.0 license.
- npm/esbuild.LICENSE: evanw/esbuild root license.
- npm/*.LICENSE MIT texts: reviewed license text and copyright attribution for
  clipboard, Standard Webhooks JavaScript, and data-uri-to-buffer packages whose
  installed package metadata declares MIT but omits a license file.

- npm/proxy-agent-negotiate.LICENSE: curated MIT text and Nathan Rajlich author
  attribution from proxy-agent-negotiate@1.1.0 metadata. Its published package
  and upstream tag omit a license file; the proxy-agents sibling packages carry
  the same MIT grant (upstream tag commit b7e5f7ccce1a3ac5b339cc4c587974e8989cbc16).

Update these pinned inputs when the associated dependency/runtime version changes.
They are copied into generated release materials and are not a legal opinion.
