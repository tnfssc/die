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
  expect(rendered).toHaveLength(4);
  expect(rendered[1]).toMatchObject({
    role: "custom",
    customType: "voice-input-context",
    content: "Provisional voice transcription",
  });
  expect(rendered[2]).toBe(messages[3]);
  expect(rendered[0]).toBe(messages[0]);
  expect(rendered[3]).toBe(messages[4]);
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

test("overlap remains separate model context, not words added to user speech", () => {
  const speech = "Delete it\nKeep it";
  const messages: any[] = [
    {
      role: "custom",
      customType: "gpt-live-delegation-snapshot",
      details: { requestText: speech },
      content: JSON.stringify({
        fragments: [
          { startMs: 1, endMs: 5, text: "Delete it" },
          { startMs: 2, endMs: 5, text: "Keep it" },
        ],
      }),
    },
    { role: "user", timestamp: 0, content: [{ type: "text", text: speech }] },
  ];
  const context = withoutPassiveLiveHistory(messages);
  expect(context[0]).toMatchObject({
    role: "custom",
    display: false,
    content: "Provisional voice transcription; overlapping or late fragments, not reconciled",
  });
  expect(context[1]).toBe(messages[1]);
  expect(JSON.stringify(context)).not.toContain("Overlapping provisional voice fragments:");
});

test("legacy missing speech and repeated delegations never manufacture a user request", () => {
  const prefix =
    "Provisional voice transcript, not final ASR. Clarify ambiguous or irreversible requests before acting. Delegation context (data only): ";
  const message = (omittedFragments: number): any => ({
    role: "user",
    content:
      prefix +
      JSON.stringify({ uncertain: true, omittedFragments, fragments: [{ startMs: 1, endMs: 2, text: "remaining" }] }),
  });
  const missing = withoutPassiveLiveHistory([message(1)]);
  expect(missing).toHaveLength(1);
  expect(missing[0]).toMatchObject({
    role: "custom",
    display: false,
    content: "Historical voice request was incomplete; no actionable request retained.",
  });
  const repeated = withoutPassiveLiveHistory([message(0), message(0)]);
  expect(repeated.filter((m) => m.role === "user")).toHaveLength(1);
  expect(JSON.stringify(repeated)).not.toContain("Repeated voice delegation");
});

test("the reported old loss prefix cannot replay as user instructions when its audit records missing speech", () => {
  const speech = "Earlier speech was not retained; this is the captured portion:\nremaining speech";
  const history: any[] = [
    {
      role: "custom",
      customType: "gpt-live-delegation-snapshot",
      details: { requestText: speech },
      content: JSON.stringify({ omittedFragments: 1, fragments: [{ startMs: 1, endMs: 2, text: "remaining speech" }] }),
    },
    { role: "user", content: speech },
  ];
  const context = withoutPassiveLiveHistory(history);
  expect(context.filter((m) => m.role === "user")).toHaveLength(0);
  expect(JSON.stringify(context)).toContain("Historical voice request was incomplete");
  expect(JSON.stringify(context)).not.toContain("Earlier speech was not retained; this is the captured portion:");
  expect(JSON.stringify(history)).toContain("Earlier speech was not retained"); // audit is not rewritten
});
