import { describe, expect, it } from "vitest";

import { scan } from "../../packages/core/src/index.js";
import {
  markdownReport,
  modalReport,
} from "../../packages/vscode/src/presentation.js";

describe("sanitized presentation", () => {
  it("does not overclaim a clean result", () => {
    const report = markdownReport(scan({ content: "hello" }));
    expect(report).toContain("Aucun secret détecté par les règles");
    expect(report).not.toContain("sûr");
  });

  it("never includes the detected value", () => {
    const token = `ghp_${"aB3d".repeat(9)}`;
    const result = scan({ content: `token=${token}` });
    expect(markdownReport(result)).not.toContain(token);
    expect(modalReport(result)).not.toContain(token);
  });

  it("names a custom detection by its label, as plain markdown text", () => {
    const base = scan({ content: `token ghp_${"aB3d".repeat(9)}` });
    const finding = {
      ...base.findings[0]!,
      custom: {
        packId: "p",
        packVersion: 1,
        detectorId: "d",
        label: "[clic](command:secretGuard.disableHook)",
        category: "project" as const,
        action: "block" as const,
      },
    };
    const report = markdownReport({ ...base, findings: [finding] });
    expect(report).toContain(
      "\\[clic\\]\\(command:secretGuard\\.disableHook\\) \\(réglage xSOM\\)",
    );
    expect(report).not.toContain("](command:");
  });
});
