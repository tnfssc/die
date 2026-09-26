import { expect, test } from "bun:test";
import { withoutPassiveLiveHistory } from "../src/live/passive-history";

test("passive voice history never enters coder context, including restored sessions", () => {
  const messages: any[] = [
    { role: "custom", customType: "live-transcript", content: [{ type: "text", text: "old speech" }] },
    {
      role: "custom",
      customType: "gpt-live-delegation-snapshot",
      content: [{ type: "text", text: '{"uncertain":true}' }],
    },
    { role: "user", content: [{ type: "text", text: "actual request" }] },
    { role: "custom", customType: "task-complete", content: [{ type: "text", text: "job done" }] },
  ];
  expect(withoutPassiveLiveHistory(messages)).toEqual(messages.slice(2));
  expect(messages).toHaveLength(4); // history is not mutated
});

test("only the associated spoken turn receives a minimal uncertainty fact, including replay", () => {
  const messages: any[] = [
    { role: "user", content: [{ type: "text", text: "Typed before voice" }] },
    {
      role: "custom",
      customType: "gpt-live-delegation-snapshot",
      details: { requestText: "Check this repo" },
      content: [{ type: "text", text: "PRIVATE_SNAPSHOT" }],
    },
    { role: "custom", customType: "live-transcript", content: [{ type: "text", text: "PRIVATE_DELTA" }] },
    { role: "user", content: [{ type: "text", text: "Check this repo" }] },
    { role: "user", content: [{ type: "text", text: "Typed after voice" }] },
  ];
  const rendered = withoutPassiveLiveHistory(messages);
  expect(rendered).toHaveLength(3);
  expect(JSON.stringify(rendered[1])).toContain("Check this repo\\n[Provisional voice transcription]");
  expect(rendered[0]).toBe(messages[0]);
  expect(rendered[2]).toBe(messages[4]);
  expect(JSON.stringify(rendered)).not.toContain("PRIVATE_");
  expect(withoutPassiveLiveHistory(structuredClone(messages))).toEqual(rendered);
  expect(withoutPassiveLiveHistory(rendered)).toEqual(rendered);
  expect(JSON.stringify(messages[3])).not.toContain("Provisional");
});

test("an unmatched audit record cannot label a subsequent typed request as voice", () => {
  const messages: any[] = [
    {
      role: "custom",
      customType: "gpt-live-delegation-snapshot",
      details: { requestText: "Rejected speech" },
      content: [],
    },
    { role: "user", content: [{ type: "text", text: "Typed request" }] },
  ];
  expect(withoutPassiveLiveHistory(messages)).toEqual([messages[1]]);
});

test("old snapshot user prompts replay as speech rather than repeated transport dumps", () => {
  const prefix =
    "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): ";
  const first = { startMs: 1, endMs: 2, text: "Pull latest changes" };
  const second = { startMs: 3, endMs: 4, text: "Anything else?" };
  const message = (fragments: unknown[]) => ({
    role: "user",
    content: [
      {
        type: "text",
        text:
          prefix +
          JSON.stringify({ uncertain: true, fragments, omittedFragments: 0, hostContext: "PRIVATE_HOST_CONTEXT" }),
      },
    ],
  });
  const history: any[] = [message([first]), message([first, second])];
  const rendered = JSON.stringify(withoutPassiveLiveHistory(history));
  expect(rendered.match(/Pull latest changes/g)).toHaveLength(1);
  expect(rendered.match(/Anything else/g)).toHaveLength(1);
  expect(rendered).not.toContain("hostContext");
  expect(rendered).not.toContain("Clarify ambiguous");
  expect(rendered).toContain("Provisional voice transcription");
  expect(JSON.stringify(history)).toContain("PRIVATE_HOST_CONTEXT");
});
