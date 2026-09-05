# Curated license inputs

The release notice generator copies LICENSE, COPYING, and NOTICE files directly
from installed production packages. The files here cover runtime material whose
published npm package does not carry its own license file, plus the compiled
runtime itself:

- pi/LICENSE: earendil-works/pi v0.85.0 root LICENSE.
- bun/LICENSE.md: oven-sh/bun bun-v1.4.1 LICENSE.md, including linked libraries.
- npm/aws-sdk-js-v3.LICENSE: aws/aws-sdk-js-v3 root Apache-2.0 license.
- npm/esbuild.LICENSE: evanw/esbuild root license.
- npm/*.LICENSE MIT texts: reviewed license text and copyright attribution for
  clipboard, Standard Webhooks JavaScript, and data-uri-to-buffer packages whose
  installed package metadata declares MIT but omits a license file.

Update these pinned inputs when the associated dependency/runtime version changes.
They are copied into generated release materials and are not a legal opinion.
