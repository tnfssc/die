import { describe, expect, test } from "bun:test";
import { assetNames, findRelease, missingReleaseAssets, tagAction } from "../scripts/publish-release";

const expected = new Map(assetNames.map((name) => [name, { name, size: 42, digest: "sha256:abc" }]));
const assets = [...expected.values()];

describe("release retry decisions", () => {
  test("new tag is pushed, same SHA reused, conflicting tag fails", () => {
    expect(tagAction(undefined, "a".repeat(40))).toBe("push");
    expect(tagAction("a".repeat(40), "a".repeat(40))).toBe("reuse");
    expect(() => tagAction("b".repeat(40), "a".repeat(40))).toThrow();
  });
  test("complete published or draft release needs no duplicate upload", () => {
    expect(missingReleaseAssets({ draft: false, assets }, expected)).toEqual([]);
    expect(missingReleaseAssets({ draft: true, assets }, expected)).toEqual([]);
  });
  test("partial draft repairs only missing verified assets", () => {
    expect(missingReleaseAssets({ draft: true, assets: assets.slice(0, 9) }, expected)).toEqual(assetNames.slice(9));
    expect(() => missingReleaseAssets({ draft: false, assets: assets.slice(0, 9) }, expected)).toThrow();
  });
  test("unknown, duplicate, wrong size or digest fails closed", () => {
    for (const bad of [
      [...assets, { name: "extra", size: 42, digest: "sha256:abc" }],
      [...assets, assets[0]!],
      [{ ...assets[0]!, size: 1 }, ...assets.slice(1)],
      [{ ...assets[0]!, digest: null }, ...assets.slice(1)],
    ])
      expect(() => missingReleaseAssets({ draft: true, assets: bad }, expected)).toThrow();
  });
});

// The failed v0.15.3 job created a draft (gh printed an untagged URL), then
// /releases/tags/v0.15.3 returned 404. A retry must find it before creating another.
test("finds an existing draft when tag lookup returns 404", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(null, { status: 404 });
    return Response.json([{ tag_name: "v0.15.3", draft: true, assets }]);
  }) as unknown as typeof fetch;
  try {
    expect((await findRelease("tnfssc/die", "v0.15.3", "token"))?.assets).toEqual(assets);
    expect(urls).toEqual([
      "https://api.github.com/repos/tnfssc/die/releases/tags/v0.15.3",
      "https://api.github.com/repos/tnfssc/die/releases?per_page=100&page=1",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("fails closed when draft list cannot be read", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => new Response(null, { status: ++calls === 1 ? 404 : 403 })) as unknown as typeof fetch;
  try {
    expect(findRelease("tnfssc/die", "v0.15.3", "token")).rejects.toThrow("HTTP 403");
  } finally {
    globalThis.fetch = original;
  }
});
