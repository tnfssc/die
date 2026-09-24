import { expect, test } from "bun:test";
import { runLiveSetup } from "../src/live/setup";
import type { LiveCredentialService, LiveCredentialStatus } from "../src/live/credentials";

function fixture(initial: LiveCredentialStatus, choices: (string | undefined)[]) {
  let status = initial;
  let imports = 0;
  const dialogs: { title: string; options: string[] }[] = [];
  const notices: string[] = [];
  const controller = new AbortController();
  const credentials: LiveCredentialService = {
    status: async () => status,
    loadKey: async () => {
      throw new Error("setup must not resolve keys");
    },
    importLiveEnv: async () => {
      imports++;
      status = { state: "stored_api_key", canImport: false };
      return { imported: true, status };
    },
  };
  const ui = {
    select: async (title: string, options: string[]) => {
      dialogs.push({ title, options });
      if (!choices.length) throw new Error("unexpected extra dialog");
      return choices.shift();
    },
    notify: (message: string) => notices.push(message),
  };
  return {
    credentials,
    ui,
    controller,
    dialogs,
    notices,
    get imports() {
      return imports;
    },
  };
}

test("configured setup offers only start or done, without reading a key", async () => {
  for (const choice of ["Start voice", "Done", undefined]) {
    const t = fixture({ state: "stored_api_key", canImport: false }, [choice]);
    expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal)).toBe(choice === "Start voice");
    expect(t.dialogs).toEqual([{ title: "Live", options: ["Start voice", "Done"] }]);
    expect(t.notices).toEqual([]);
    expect(t.imports).toBe(0);
  }
});

test("missing auth gives focused instructions and only available next actions", async () => {
  const t = fixture({ state: "missing", canImport: true }, ["Cancel"]);
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal, () => false)).toBe(false);
  expect(t.dialogs[0]?.options).toEqual(["Recheck", "Cancel"]);
  expect(t.notices.join(" ")).toContain("Never paste keys into chat");
  expect(t.imports).toBe(0);
});

test("import is explicit and does not automatically start voice", async () => {
  const t = fixture({ state: "missing", canImport: true }, ["Import ~/.die/live.env", "Done"]);
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal, () => true)).toBe(false);
  expect(t.imports).toBe(1);
  expect(t.notices[0]).toContain("Import saves");
  expect(t.notices[0]).not.toContain("Create");
  expect(t.dialogs[0]?.options).toEqual(["Import ~/.die/live.env", "Recheck", "Cancel"]);
  expect(t.dialogs[1]?.options).toEqual(["Start voice", "Done"]);
});

test("OAuth setup never offers import or replacement", async () => {
  const t = fixture({ state: "oauth", canImport: false }, ["Cancel"]);
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal, () => true)).toBe(false);
  expect(t.dialogs[0]?.options).toEqual(["Recheck", "Cancel"]);
  expect(t.notices[0]).toContain("will not be replaced");
  expect(t.imports).toBe(0);
});

test("failed import hides exception and remains cancellable", async () => {
  const t = fixture({ state: "missing", canImport: true }, ["Import ~/.die/live.env", "Cancel"]);
  t.credentials.importLiveEnv = async () => {
    throw new Error("SECRET key");
  };
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal, () => true)).toBe(false);
  expect(t.notices.join(" ")).not.toContain("SECRET");
  expect(t.notices.at(-1)).toContain("Could not import");
});

test("cancelled inspection and late start choice cannot authorize voice", async () => {
  const t = fixture({ state: "stored_api_key", canImport: false }, ["Start voice"]);
  t.credentials.status = async () => {
    t.controller.abort();
    return { state: "stored_api_key", canImport: false };
  };
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal)).toBe(false);
  expect(t.dialogs).toEqual([]);
  const late = fixture({ state: "stored_api_key", canImport: false }, []);
  late.ui.select = async () => {
    late.controller.abort();
    return "Start voice";
  };
  expect(await runLiveSetup(late.ui, late.credentials, late.controller.signal)).toBe(false);
});

test("cancelled import cannot show a ready menu or start", async () => {
  const t = fixture({ state: "missing", canImport: true }, ["Import ~/.die/live.env"]);
  t.credentials.importLiveEnv = async () => {
    t.controller.abort();
    return { imported: false, status: { state: "missing", canImport: true } };
  };
  expect(await runLiveSetup(t.ui, t.credentials, t.controller.signal, () => true)).toBe(false);
  expect(t.dialogs).toHaveLength(1);
});
