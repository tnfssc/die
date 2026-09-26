// Source CLI project trust depends on resources in cwd and its ancestors, not on CI.
// A clean checkout can start directly; a developer checkout may ask for session trust.
export async function waitForLiveTuiStartup(
  frame: () => Promise<string>,
  sendKey: (key: string) => Promise<unknown>,
  fixture: string,
): Promise<void> {
  for (let n = 0; n < 100; n++) {
    const screen = await frame();
    if (screen.includes(fixture)) return;
    if (screen.includes("Trust project folder?")) {
      await sendKey("Down");
      await sendKey("Down");
      await sendKey("Enter"); // Trust (this session only); never persist approval.
      break;
    }
    await Bun.sleep(80);
  }
  for (let n = 0; n < 100; n++) {
    const screen = await frame();
    if (screen.includes(fixture)) return;
    await Bun.sleep(80);
  }
  throw new Error("Missing " + fixture + " in actual terminal:\n" + (await frame()));
}
