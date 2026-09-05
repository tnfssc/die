# Third-party notices

Die is built on Pi and includes third-party dependencies. Those components remain
subject to their own licenses; the project's MIT license does not replace them.
Consult `bun.lock` and the installed packages' metadata/license files for the
complete dependency inventory for a particular source revision.

The compiled executable embeds runtime assets copied from
`@earendil-works/pi-coding-agent` 0.85.0. In particular:

- `highlight.min.js` identifies Highlight.js 11.9.0 and retains its BSD-3-Clause
  license banner.
- `marked.min.js` identifies Marked 18.0.5 and retains its MIT license banner.
- Pi themes, HTML templates, and artwork remain covered by their upstream terms.

Do not remove copyright or license banners from packaged runtime assets. Before
adding or updating an embedded asset, verify its redistribution terms and preserve
all required notices in the generated artifact and release materials.
