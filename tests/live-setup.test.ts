import { describe, expect, test } from "bun:test";
import { type LiveSetupDependencies, type LiveSetupStatus, type LiveSetupUI, runLiveSetup } from "../src/live/setup";

type Event = { type: "select" | "confirm" | "notify"; title: string; detail?: string; options?: string[] };

function harness(choices: Array<string | undefined | boolean>, overrides: Partial<LiveSetupDependencies> = {}) {
  const events: Event[] = [];
  const calls = { status: 0, capabilities: 0, importKey: 0, testConnection: 0, start: 0 };
  const status: LiveSetupStatus = { configured: false, canImport: false, message: "No Google credential configured." };
  const ui: LiveSetupUI = {
    async select(title, options) {
      events.push({ type: "select", title, options: [...options] });
      return choices.shift() as string | undefined;
    },
    async confirm(title, detail) {
      events.push({ type: "confirm", title, detail });
      return choices.shift() as boolean;
    },
    notify(title) {
      events.push({ type: "notify", title });
    },
  };
  const deps: LiveSetupDependencies = {
    platform: () => "linux",
    async status() {
      calls.status++;
      return status;
    },
    async capabilities() {
      calls.capabilities++;
      return { supported: true };
    },
    async importKey() {
      calls.importKey++;
    },
    async testConnection() {
      calls.testConnection++;
    },
    async start() {
      calls.start++;
    },
    ...overrides,
  };
  return { ui, deps, events, calls };
}

const text = (events: Event[]) =>
  events.map((event) => [event.title, event.detail, ...(event.options ?? [])].join(" ")).join("\n");
const menus = (events: Event[]) => events.filter((event) => event.type === "select");

describe("Live setup wizard", () => {
  test("opening and cancelling only performs side-effect-free inspection", async () => {
    const h = harness([undefined]);
    await runLiveSetup(h.ui, h.deps);

    expect(h.calls).toEqual({ status: 1, capabilities: 1, importKey: 0, testConnection: 0, start: 0 });
    expect(text(h.events)).toContain("local Linux SoX");
    expect(text(h.events)).toContain("Install SoX with your distribution package manager");
    expect(text(h.events)).toContain("default microphone and speakers");
    expect(text(h.events)).toContain("paid");
    expect(text(h.events)).toContain("no echo cancellation");
    expect(text(h.events)).toContain("current session");
  });

  test("Darwin setup failure shows install and microphone privacy guidance without connecting", async () => {
    const h = harness([undefined], {
      platform: () => "darwin",
      async capabilities() {
        h.calls.capabilities++;
        return { supported: false, reason: "SoX is unavailable." };
      },
    });
    await runLiveSetup(h.ui, h.deps);

    const rendered = text(h.events);
    expect(rendered).toContain("brew install sox");
    expect(rendered).toContain("default microphone and output");
    expect(rendered).toContain("Privacy & Security > Microphone");
    expect(rendered).toContain("Terminal (or the app running die)");
    expect(rendered).toContain("restart Terminal or the app if necessary");
    expect(rendered).toContain("Use headphones");
    expect(rendered).toContain("no echo cancellation");
    expect(rendered).toContain("Opening setup does not connect to Google or open audio devices");
    expect(h.calls).toEqual({ status: 1, capabilities: 1, importKey: 0, testConnection: 0, start: 0 });
  });

  test("Darwin readiness stays device-untested and never starts automatically", async () => {
    const h = harness([undefined], { platform: () => "darwin" });
    await runLiveSetup(h.ui, h.deps);
    expect(text(h.events)).toContain("devices untested");
    expect(text(h.events)).toContain("macOS may ask when you explicitly start Live");
    expect(text(h.events)).not.toContain("local Linux");
    expect(h.calls).toEqual({ status: 1, capabilities: 1, importKey: 0, testConnection: 0, start: 0 });
  });

  test("unsupported platforms are not described as Linux", async () => {
    const h = harness([undefined], { platform: () => "win32" });
    await runLiveSetup(h.ui, h.deps);
    expect(text(h.events)).toContain("supports Linux and macOS only");
    expect(text(h.events)).not.toContain("local Linux SoX");
    expect(h.calls.start).toBe(0);
  });

  test("missing credentials offer instructions and safe back without key input", async () => {
    const h = harness(["Show secure credential-file instructions", "Back", "Done"]);
    await runLiveSetup(h.ui, h.deps);

    const rendered = text(h.events);
    expect(rendered).toContain("~/.die/live.env");
    expect(rendered).toContain("0600");
    expect(rendered).toContain("exactly one literal GEMINI_API_KEY=your-key assignment");
    expect(rendered).toContain("external local editor");
    expect(rendered).toContain("Never paste a key into chat");
    expect(rendered).toContain("shell command containing the key");
    expect(rendered).toContain("leaves live.env in place");
    expect(menus(h.events)[0]?.options).not.toContain("Start Live");
    expect(menus(h.events)[0]?.options).not.toContain("Test paid connection (no microphone or speakers)");
    expect(h.calls.importKey).toBe(0);
  });

  test("offers import only when Google auth can accept an import", async () => {
    let configured = false;
    const h = harness(["Import key from ~/.die/live.env", true, "Done"], {
      async status() {
        h.calls.status++;
        return {
          configured,
          canImport: !configured,
          message: configured ? "Existing Google auth is ready." : "A safe local import file is ready.",
        };
      },
      async importKey() {
        h.calls.importKey++;
        configured = true;
      },
    });
    await runLiveSetup(h.ui, h.deps);

    expect(h.calls.importKey).toBe(1);
    expect(h.calls.status).toBe(2);
    expect(text(h.events)).toContain("Unrelated provider keys and OAuth are preserved");
    expect(text(h.events)).toContain("file remains in place");
    expect(menus(h.events).at(-1)?.options).toContain("Start Live");
  });

  test("declining import has no credential side effect", async () => {
    const h = harness(["Import key from ~/.die/live.env", false, "Done"], {
      async status() {
        return { configured: false, canImport: true, message: "Import is available." };
      },
    });
    await runLiveSetup(h.ui, h.deps);
    expect(h.calls.importKey).toBe(0);
  });

  test("configured setup is reused and paid test requires separate consent", async () => {
    const h = harness(
      [
        "Test paid connection (no microphone or speakers)",
        false,
        "Test paid connection (no microphone or speakers)",
        true,
        "Done",
      ],
      {
        async status() {
          return { configured: true, canImport: false, message: "Existing Google provider auth is ready." };
        },
      },
    );
    await runLiveSetup(h.ui, h.deps);

    expect(h.calls.testConnection).toBe(1);
    expect(h.calls.start).toBe(0);
    const confirmations = h.events.filter((event) => event.type === "confirm");
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]?.detail).toContain("paid Google setup connection only");
    expect(confirmations[0]?.detail).toContain("does not open the microphone or speakers");
  });

  test("start is available only when credentials and local prerequisites are ready", async () => {
    const unsupported = harness(["Done"], {
      async status() {
        return { configured: true, canImport: false, message: "Auth ready." };
      },
      async capabilities() {
        return { supported: false, reason: "SoX is unavailable." };
      },
    });
    await runLiveSetup(unsupported.ui, unsupported.deps);
    expect(menus(unsupported.events)[0]?.options).not.toContain("Start Live");

    const ready = harness(["Start Live", false, "Start Live", true], {
      async status() {
        return { configured: true, canImport: false, message: "Auth ready." };
      },
    });
    await runLiveSetup(ready.ui, ready.deps);
    expect(ready.calls.start).toBe(1);
    expect(ready.calls.testConnection).toBe(0);
    const review = ready.events.filter((event) => event.type === "confirm")[0]?.detail ?? "";
    expect(review).toContain("paid Google Live session");
    expect(review).toContain("default microphone and speakers");
    expect(review).toContain("shared with Google");
    expect(review).toContain("no echo cancellation");
  });

  test("refresh retries failed inspection and updates available actions", async () => {
    let attempt = 0;
    const h = harness(["Refresh / recheck", "Done"], {
      async status() {
        if (attempt++ === 0) throw new Error("SECRET status failure");
        return { configured: true, canImport: false, message: "Credentials ready." };
      },
      async capabilities() {
        if (attempt === 1) throw new Error("SECRET capability failure");
        return { supported: true };
      },
    });
    await runLiveSetup(h.ui, h.deps);

    expect(menus(h.events)[0]?.options).not.toContain("Start Live");
    expect(menus(h.events)[1]?.options).toContain("Start Live");
    expect(text(h.events)).not.toContain("SECRET");
  });

  test("operation failures are static and never expose exception secrets", async () => {
    const secret = "AIza-DO-NOT-RENDER";
    const h = harness(["Import key from ~/.die/live.env", true, "Import key from ~/.die/live.env", true, "Done"], {
      async status() {
        return { configured: false, canImport: true, message: "Import available." };
      },
      async importKey() {
        h.calls.importKey++;
        throw new Error(secret);
      },
    });
    await runLiveSetup(h.ui, h.deps);
    expect(h.calls.importKey).toBe(2);
    expect(text(h.events)).not.toContain(secret);
    expect(text(h.events)).toContain("Check the file, ownership, and mode; refresh provider status");
  });

  test("connection and start failures can be retried without automatic retries", async () => {
    let testAttempts = 0;
    let startAttempts = 0;
    const h = harness(
      [
        "Test paid connection (no microphone or speakers)",
        true,
        "Test paid connection (no microphone or speakers)",
        true,
        "Start Live",
        true,
        "Start Live",
        true,
      ],
      {
        async status() {
          return { configured: true, canImport: false, message: "Ready." };
        },
        async testConnection() {
          h.calls.testConnection++;
          if (testAttempts++ === 0) throw new Error("private network response");
        },
        async start() {
          h.calls.start++;
          if (startAttempts++ === 0) throw new Error("private audio response");
        },
      },
    );
    await runLiveSetup(h.ui, h.deps);
    expect(h.calls.testConnection).toBe(2);
    expect(h.calls.start).toBe(2);
    expect(text(h.events)).not.toContain("private");
  });

  test("a stale lifecycle prevents all operational side effects", async () => {
    let current = true;
    const h = harness(["Start Live", true], {
      async status() {
        return { configured: true, canImport: false, message: "Ready." };
      },
      isCurrent() {
        return current;
      },
    });
    h.ui.confirm = async (title, detail) => {
      h.events.push({ type: "confirm", title, detail });
      current = false;
      return true;
    };
    await runLiveSetup(h.ui, h.deps);
    expect(h.calls.start).toBe(0);
    expect(h.calls.testConnection).toBe(0);
    expect(h.calls.importKey).toBe(0);
  });

  test("already-stale lifecycle does not inspect or render", async () => {
    const h = harness([], { isCurrent: () => false });
    await runLiveSetup(h.ui, h.deps);
    expect(h.events).toEqual([]);
    expect(h.calls.status).toBe(0);
    expect(h.calls.capabilities).toBe(0);
  });
});
