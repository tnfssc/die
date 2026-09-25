import { expect, test } from "bun:test";
import { CompletedInput } from "../src/session/input";
import { TranscriptLog } from "../src/session/transcript";

test("history finality is not input authority; only explicit completed input can be consumed", () => {
  const input = new CompletedInput();
  const history = new TranscriptLog(() => {});
  history.receive("You", { text: "old request", finished: true });
  input.attempt("old");
  expect(() => input.consume()).toThrow("eligible completed");
  input.capture("new request");
  expect(() => input.attempt("old")).toThrow("already attempted");
  input.attempt("new");
  expect(input.consume()).toBe("new request");
  expect(() => input.consume()).toThrow("eligible completed");
});

test("activity, oversized capture and expiration revoke input without forgetting attempted IDs", () => {
  let now = 0;
  const input = new CompletedInput(() => now);
  input.capture("first");
  input.attempt("first");
  input.revoke();
  expect(() => input.consume()).toThrow("eligible completed");
  input.capture("second");
  now = 60_000;
  expect(() => input.consume()).toThrow("eligible completed");
  input.capture("third");
  input.capture("x".repeat(4001));
  expect(() => input.consume()).toThrow("eligible completed");
  expect(() => input.attempt("first")).toThrow("already attempted");
});

test("request ledger fails closed at capacity", () => {
  const input = new CompletedInput();
  for (let i = 0; i < 256; i++) input.attempt(String(i));
  input.capture("new");
  expect(() => input.attempt("overflow")).toThrow("request limit");
  expect(() => input.attempt("0")).toThrow("already attempted");
});
