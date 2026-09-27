import { describe, expect, it } from "vitest";
import { compileRulesPack } from "@xsom/secret-guard-core";
import { runHook } from "../../packages/cli/src/hook.js";
import { largestRulesPack } from "../../scripts/largest-rules-pack.mjs";

// One hook decision scans the prompt and up to 20 mentioned files. The xSOM
// tuning of all those scans draws from one work budget, so the hook always
// answers well before the host's timeout.
describe("hook decision budget with an xSOM tuning", () => {
  it(
    "shares one budget between the prompt and the files it mentions",
    {
      timeout: 120_000,
    },
    () => {
      const compiled = compileRulesPack(largestRulesPack(), {
        selfTests: false,
      });
      if (!compiled.ok) throw new Error(compiled.error);
      // About 60 000 distinct words: each file alone fits the budget.
      let seed = 1;
      const word = () => {
        seed = (seed * 48271) % 2147483647;
        return `w${seed.toString(36)}`;
      };
      const file = Array.from({ length: 60_000 }, word).join(" ");
      const reads: string[] = [];
      const readFile = (path: string) => {
        reads.push(path);
        return { status: "text" as const, content: file };
      };
      const alone = runHook(
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: "Relis @one.txt",
          cwd: "/tmp",
        }),
        "block",
        readFile,
        compiled.pack,
      );
      expect(alone.continue).toBe(true);
      const together = runHook(
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          prompt: "Relis @one.txt @two.txt @three.txt",
          cwd: "/tmp",
        }),
        "block",
        readFile,
        compiled.pack,
      );
      expect(together.continue).toBe(false);
      expect(together.stopReason).toContain("n’a pas pu analyser");
      expect(reads).toHaveLength(4);
    },
  );
});
