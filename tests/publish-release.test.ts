import { describe, expect, test } from "bun:test";
import { assetNames, missingReleaseAssets, tagAction } from "../scripts/publish-release";

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
