import { describe, expect, it } from "vitest";

import { scan } from "../../packages/core/src/index.js";
import {
  composePrompt,
  unreadableReferencesMessage,
} from "../../packages/vscode/src/chat-references.js";

const fakeToken = `ghp_${"aB3d".repeat(9)}`;

describe("@secretguard references", () => {
  it("keeps the prompt alone when nothing is attached", () => {
    expect(composePrompt("explain", [])).toBe("explain");
  });

  it("puts every attached text in the single scanned message", () => {
    const content = composePrompt("résume #file:notes.md", [
      { status: "text", label: "docs/notes.md", content: `token=${fakeToken}` },
    ]);
    expect(content).toContain("[Pièce jointe : docs/notes.md]");
    expect(content).toContain("[Fin de la pièce jointe : docs/notes.md]");
    const result = scan({ content, sourceKind: "prompt" });
    expect(result.decision).toBe("BLOCK");
  });

  it("names unreadable references without breaking the markdown", () => {
    const message = unreadableReferencesMessage(["image.png", "a`b\nc.md"]);
    expect(message).toContain("Envoi bloqué");
    expect(message).toContain("- `image.png`");
    expect(message).toContain("- `a b c.md`");
  });
});
