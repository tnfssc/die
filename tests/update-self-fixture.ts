import { createHash } from "node:crypto";
import { RELEASES_URL, UPDATE_ASSET, updateDie } from "../src/update";
const payload = process.env.DIE_TEST_UPDATE_PAYLOAD;
if (!payload) throw new Error("Private updater test payload is required");
const bytes = await Bun.file(payload).bytes();
const root = "https://github.com/tnfssc/die/releases/download/v0.3.0/";
const digest = createHash("sha256").update(bytes).digest("hex");
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === RELEASES_URL)
    return Response.json({
      tag_name: "v0.3.0",
      draft: false,
      prerelease: false,
      assets: [UPDATE_ASSET, UPDATE_ASSET + ".sha256"].map((name) => ({ name, browser_download_url: root + name })),
    });
  if (url === root + UPDATE_ASSET) return new Response(bytes);
  if (url === root + UPDATE_ASSET + ".sha256") return new Response(digest + "  " + UPDATE_ASSET + "\n");
  throw new Error("Unexpected test URL");
}) as unknown as typeof fetch;
console.log(JSON.stringify(await updateDie({ currentVersion: "0.2.15", fetch: mockFetch })));
