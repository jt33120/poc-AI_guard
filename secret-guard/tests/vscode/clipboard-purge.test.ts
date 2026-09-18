import { describe, expect, it } from "vitest";

import { MAX_INPUT_BYTES } from "@xsom/secret-guard-core";
import {
  purgeClipboardText,
  purgeFeedback,
  PURGE_UNAVAILABLE,
} from "../../packages/vscode/src/clipboard-purge.js";

const fakeToken = `ghp_${"aB3d".repeat(9)}`;

describe("clipboard purge", () => {
  it("replaces every detected secret with a text that rescans clean", () => {
    const outcome = purgeClipboardText(
      `deploy with ${fakeToken}\nPASSWORD=${fakeToken}`,
    );
    expect(outcome.status).toBe("purged");
    if (outcome.status !== "purged") return;
    expect(outcome.findings).toBeGreaterThanOrEqual(1);
    expect(outcome.content).toContain("deploy with");
    expect(outcome.content).not.toContain(fakeToken);
    expect(purgeFeedback(outcome)).toEqual({
      text: expect.stringMatching(
        /^\$\(check\) Presse-papiers expurgé · \d+ secrets? masqués?$/u,
      ) as unknown,
      failed: false,
    });
  });

  it("agrees the count with the number of secrets", () => {
    expect(
      purgeFeedback({ status: "purged", content: "x", findings: 1 }).text,
    ).toBe("$(check) Presse-papiers expurgé · 1 secret masqué");
    expect(
      purgeFeedback({ status: "purged", content: "x", findings: 3 }).text,
    ).toBe("$(check) Presse-papiers expurgé · 3 secrets masqués");
  });

  it("leaves a clean clipboard alone and says so", () => {
    const outcome = purgeClipboardText("explain this function");
    expect(outcome).toEqual({ status: "clean" });
    expect(purgeFeedback(outcome)).toEqual({
      text: "$(check) Presse-papiers sûr · aucun secret",
      failed: false,
    });
  });

  it("reports an empty or non-text clipboard without scanning", () => {
    expect(purgeClipboardText("")).toEqual({ status: "empty" });
    expect(purgeClipboardText("  \n\t")).toEqual({ status: "empty" });
    expect(purgeFeedback({ status: "empty" }).failed).toBe(false);
  });

  it("never offers a replacement when the scan is incomplete", () => {
    const outcome = purgeClipboardText(
      `${fakeToken} ${"a".repeat(MAX_INPUT_BYTES)}`,
    );
    expect(outcome).toMatchObject({ status: "failed", reason: "incomplete" });
    expect(JSON.stringify(outcome)).not.toContain(fakeToken);
    const feedback = purgeFeedback(outcome);
    expect(feedback.failed).toBe(true);
    expect(feedback.text).toBe("$(error) Presse-papiers non expurgé");
    expect(feedback.message).toContain("n’a pas été modifié");
  });

  it("explains a residual secret and an unreachable clipboard as failures", () => {
    const residual = purgeFeedback({
      status: "failed",
      reason: "residual",
      findings: 1,
    });
    expect(residual.failed).toBe(true);
    expect(residual.message).toContain("Un secret subsiste");
    expect(PURGE_UNAVAILABLE.failed).toBe(true);
    expect(PURGE_UNAVAILABLE.message).toContain("Ne le collez pas tel quel");
  });
});
