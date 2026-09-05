# Third-party notices

Die is built on Pi and includes third-party dependencies and the Bun runtime.
Those components remain subject to their own licenses; the project's MIT license
does not replace them.

Every release includes THIRD_PARTY_LICENSES.txt, a bounded, generated attribution
bundle containing the complete LICENSE, COPYING, and NOTICE files found in the
installed production dependency graph. It also reproduces the pinned Pi 0.85.0
license and Bun 1.4.1's upstream runtime and linked-library licensing notice.
The generator fails on an unrecognized package with no notice file so omissions
must be reviewed rather than silently reduced to package names or links.

The executable embeds Pi runtime assets. Highlight.js and Marked retain their
license banners, while the generated attribution bundle includes their full
packaged licenses and the licenses for the Pi packages that supply themes,
templates, artwork, and application code. Do not remove those notices or banners.

The Bun runtime includes upstream components under additional terms, including
JavaScriptCore/WebKit under LGPL-2 as described in Bun's reproduced LICENSE.md.
The upstream notice identifies source and relinking information. This material is
provided for attribution and transparency, not as legal advice or a guarantee of
license compliance. Review applicable obligations before redistribution.
