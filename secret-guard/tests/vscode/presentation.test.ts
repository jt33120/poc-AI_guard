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
});
