/** Screenshots of the canonical route/component with offline Pi peer. Not packaged app. */
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
const {
  DIE_LIVE_BROWSER_URL: url,
  DIE_LIVE_BROWSER_MISSING_URL: missingUrl,
  DIE_PACKAGED_CSS: cssPath,
  DIE_CHROMIUM: chrome,
  DIE_PLAYWRIGHT_CORE: pw,
} = process.env;
assert(
  url && missingUrl && cssPath && chrome && pw,
  "Launch tests/browser/live-route-bootstrap.ts; set DIE_LIVE_BROWSER_URL, DIE_LIVE_BROWSER_MISSING_URL, DIE_PACKAGED_CSS, DIE_CHROMIUM, DIE_PLAYWRIGHT_CORE",
);
const origins = new Set([new URL(url).origin, new URL(missingUrl).origin]);
assert.equal(new URL(url).hostname, "127.0.0.1");
assert.equal(new URL(missingUrl).hostname, "127.0.0.1");
const output = resolve(process.env.DIE_CAPTURE_DIR ?? "docs/screenshots/web-live");
const css = await Bun.file(cssPath).text();
const { chromium } = await import(pathToFileURL(resolve(pw, "index.mjs")).href);
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const files: string[] = [];
async function page(target: string, width: number, height: number) {
  const p = await browser.newPage({ viewport: { width, height } });
  await p.route("**/*", (request) =>
    origins.has(new URL(request.request().url()).origin) ? request.continue() : request.abort(),
  );
  await p.goto(target);
  await p.getByRole("button", { name: "Start voice" }).waitFor();
  await p.addStyleTag({ content: css });
  await p.evaluate(() => {
    document.body.style.background = "var(--background)";
    document.body.style.color = "var(--foreground)";
    const root = document.getElementById("root")!;
    const main = document.createElement("main");
    main.style.cssText = "max-width:860px;margin:14vh auto;padding:24px";
    const label = document.createElement("p");
    label.style.cssText = "font-size:12px;opacity:.65";
    label.textContent = "OFFLINE COMPONENT FIXTURE · canonical VoiceControls / real route";
    const title = document.createElement("h1");
    title.style.cssText = "font-size:28px;margin:12px 0 28px";
    title.textContent = "Live voice";
    const section = document.createElement("section");
    section.style.cssText = "border:1px solid var(--border);border-radius:12px;padding:16px";
    const note = document.createElement("p");
    note.style.cssText = "font-size:12px;opacity:.6;margin-top:18px";
    note.textContent = "Synthetic thread · fake owning Pi provider · no account, real provider, or conversation data";
    document.body.append(main);
    main.append(label, title, section, note);
    section.append(root);
  });
  return p;
}
async function shot(p: any, name: string) {
  const file = join(output, name + ".png");
  await p.screenshot({ path: file });
  files.push(file);
}
try {
  const desktop = await page(url, 1280, 800);
  await shot(desktop, "fixture-desktop-idle");
  await desktop.getByRole("button", { name: "Start voice" }).click();
  await desktop.getByRole("status").filter({ hasText: "Voice connected" }).waitFor({ timeout: 20000 });
  await shot(desktop, "fixture-desktop-connected");
  await desktop.getByRole("button", { name: "Mute", exact: true }).click();
  await desktop.getByRole("status").filter({ hasText: "Voice muted" }).waitFor();
  await shot(desktop, "fixture-desktop-muted");
  await desktop.getByRole("button", { name: "End voice" }).click();
  await desktop.getByRole("button", { name: "Start voice" }).waitFor();
  await desktop.close();
  const narrow = await page(url, 390, 844);
  await narrow.getByRole("combobox", { name: "Voice provider" }).selectOption({ label: "OpenAI" });
  await shot(narrow, "fixture-narrow-idle");
  await narrow.getByRole("button", { name: "Start voice" }).click();
  await narrow.getByRole("status").filter({ hasText: "Voice connected" }).waitFor({ timeout: 20000 });
  await shot(narrow, "fixture-narrow-connected");
  await narrow.getByRole("button", { name: "End voice" }).click();
  await narrow.getByRole("button", { name: "Start voice" }).waitFor();
  await narrow.close();
  const error = await page(missingUrl, 1280, 800);
  await error.getByRole("combobox", { name: "Voice provider" }).selectOption({ label: "OpenAI" });
  await error.getByRole("button", { name: "Start voice" }).click();
  await error
    .getByRole("status")
    .filter({ hasText: /credentials/i })
    .waitFor({ timeout: 20000 });
  await shot(error, "fixture-desktop-missing-credentials");
  await error.close();
  console.log(JSON.stringify({ screenshots: files }));
} finally {
  await browser.close();
}
