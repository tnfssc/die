import { describe, expect, test } from "bun:test";
import { MAX_ERROR_DIAGNOSTIC_CHARACTERS, formatThrownValue } from "../src/typescript/error-diagnostic";

describe("isolated runner error diagnostics", () => {
  test("restores an Error message omitted from a nonempty stack", () => {
    const error = new Error("cleanup failed");
    error.stack = "Error\n    at <execute-module>:5:9\n    at processTicksAndRejections (unknown:7:39)";

    expect(formatThrownValue(error)).toBe(
      "Error: cleanup failed\n    at <execute-module>:5:9\n    at processTicksAndRejections (unknown:7:39)",
    );
  });

  test("does not trust Error property getters or non-Error conversion hooks", () => {
    const error = new Error("unused");
    Object.defineProperties(error, {
      name: {
        get: () => {
          throw new Error("name getter failed");
        },
      },
      message: {
        get: () => {
          throw new Error("message getter failed");
        },
      },
      stack: {
        get: () => {
          throw new Error("stack getter failed");
        },
      },
    });
    const hostile = {
      [Symbol.toPrimitive]: () => {
        throw new Error("conversion failed");
      },
    };

    expect(formatThrownValue(error)).toBe("Error: [message unavailable]\n    [stack unavailable]");
    expect(formatThrownValue(hostile)).toBe("[unable to format thrown value]");
    expect(formatThrownValue("plain failure")).toBe("plain failure");
  });

  test("bounds diagnostics while retaining the useful prefix", () => {
    const diagnostic = formatThrownValue("failure: " + "x".repeat(MAX_ERROR_DIAGNOSTIC_CHARACTERS * 2));

    expect(diagnostic.length).toBe(MAX_ERROR_DIAGNOSTIC_CHARACTERS);
    expect(diagnostic.startsWith("failure: ")).toBe(true);
    expect(diagnostic.endsWith("… error diagnostic truncated")).toBe(true);
  });
});
