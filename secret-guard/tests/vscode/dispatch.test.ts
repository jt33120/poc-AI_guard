import { describe, expect, it, vi } from "vitest";

import type { ScanInput, ScanResult } from "../../packages/core/src/index.js";
import { dispatchGuarded } from "../../packages/vscode/src/dispatch.js";

const fakeToken = `ghp_${"aB3d".repeat(9)}`;

function warningResult(content: string): ScanResult {
  return {
    decision: "WARN",
    level: "MEDIUM",
    score: 35,
    complete: true,
    inputBytes: content.length,
    rulesetVersion: "test",
    findings: [
      {
        ruleId: "entropy",
        secretType: "generic_secret",
        score: 35,
        level: "MEDIUM",
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: content.length, line: 1, column: content.length + 1 },
        },
        reasons: ["high_entropy"],
        encoding: "plain",
      },
    ],
  };
}

describe("authoritative dispatch gate", () => {
  it("calls the transport exactly once for clean content", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("explain this function", {
      chooseForWarning: () => Promise.resolve("cancel"),
      transport,
    });
    expect(outcome.sent).toBe(true);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("never calls the transport for a blocking finding", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded(`use ${fakeToken}`, {
      chooseForWarning: () => Promise.resolve("send"),
      transport,
    });
    expect(outcome.sent).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rescans the exact redacted content before one send", async () => {
    const scans: string[] = [];
    const scanner = (input: ScanInput): ScanResult => {
      scans.push(input.content);
      if (scans.length === 1) {
        return {
          decision: "WARN",
          level: "MEDIUM",
          score: 35,
          complete: true,
          inputBytes: input.content.length,
          rulesetVersion: "test",
          findings: [
            {
              ruleId: "entropy",
              secretType: "generic_secret",
              score: 35,
              level: "MEDIUM",
              span: {
                start: { offset: 0, line: 1, column: 1 },
                end: {
                  offset: input.content.length,
                  line: 1,
                  column: input.content.length + 1,
                },
              },
              reasons: ["high_entropy"],
              encoding: "plain",
            },
          ],
        };
      }
      return {
        decision: "ALLOW",
        level: "LOW",
        score: 0,
        complete: true,
        inputBytes: input.content.length,
        rulesetVersion: "test",
        findings: [],
      };
    };
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("ambiguous-random-value", {
      chooseForWarning: () => Promise.resolve("redact"),
      transport,
      scanner,
    });
    expect(scans).toHaveLength(2);
    expect(scans[1]).not.toBe(scans[0]);
    expect(transport).toHaveBeenCalledExactlyOnceWith(scans[1]);
    expect(outcome.redacted).toBe(true);
  });

  it("allows an explicit WARN override and sends the exact original once", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const content = "ambiguous-random-value";
    const outcome = await dispatchGuarded(content, {
      chooseForWarning: () => Promise.resolve("send"),
      transport,
      scanner: () => warningResult(content),
    });

    expect(outcome.sent).toBe(true);
    expect(transport).toHaveBeenCalledExactlyOnceWith(content);
  });

  it("sends nothing when a WARN is cancelled", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("ambiguous-random-value", {
      chooseForWarning: () => Promise.resolve("cancel"),
      transport,
      scanner: (input) => warningResult(input.content),
    });

    expect(outcome.sent).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("sends nothing when a redacted rescan remains WARN", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("ambiguous-random-value", {
      chooseForWarning: () => Promise.resolve("redact"),
      transport,
      scanner: (input) => warningResult(input.content),
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.final.decision).toBe("WARN");
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed when the scanner throws", async () => {
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("content", {
      chooseForWarning: () => Promise.resolve("send"),
      transport,
      scanner: () => {
        throw new Error("boom");
      },
    });
    expect(outcome.sent).toBe(false);
    expect(outcome.final.complete).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed when the authoritative redacted rescan throws", async () => {
    let calls = 0;
    const transport = vi
      .fn<(content: string) => Promise<void>>()
      .mockResolvedValue();
    const outcome = await dispatchGuarded("ambiguous-random-value", {
      chooseForWarning: () => Promise.resolve("redact"),
      transport,
      scanner: (input) => {
        calls += 1;
        if (calls === 1) return warningResult(input.content);
        throw new Error("rescan failed");
      },
    });

    expect(outcome.sent).toBe(false);
    expect(outcome.final.complete).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });
});
