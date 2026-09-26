import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileRulesPack,
  redactAndRescan,
  scan,
  type RulesPackPayload,
} from "@xsom/secret-guard-core";

// Product promises that are not already pinned by a feature test. Each case
// names the claim of docs/secret-guard/CLAIMS.md it proves.

const manifest = JSON.parse(
  readFileSync("packages/vscode/package.json", "utf8"),
) as {
  description: string;
  engines: { vscode: string };
  contributes: {
    configuration: {
      properties: Record<string, { default?: unknown }>;
    };
    commands: { command: string; title: string }[];
  };
};
const vectors = JSON.parse(
  readFileSync("contracts/fixtures/rules-pack-vectors.json", "utf8"),
) as { packs: { pack: RulesPackPayload }[] };
// Assembled at run time so the dogfood scan of this file stays clean.
const TOKEN = ["ghp", "Zx9k".repeat(9)].join("_");

describe("promises of the product copy", () => {
  it("« filtrage déterministe » : same text, same verdict, with or without a tuning", () => {
    const text = `CLI-00421337, SIRET 55210055400013, ${TOKEN}, Projet Faucon`;
    const first = compileRulesPack(vectors.packs[0]!.pack);
    const second = compileRulesPack(structuredClone(vectors.packs[0]!.pack));
    if (!first.ok || !second.ok) throw new Error("reference pack refused");
    expect(scan({ content: text, rules: first.pack })).toEqual(
      scan({ content: text, rules: second.pack }),
    );
    expect(scan({ content: text })).toEqual(scan({ content: text }));
    expect(redactAndRescan({ content: text, rules: first.pack })).toEqual(
      redactAndRescan({ content: text, rules: second.pack }),
    );
  });

  it("« mode prudent par défaut » : Bloquer, hooks configured automatically", () => {
    const settings = manifest.contributes.configuration.properties;
    expect(settings["secretGuard.mode"]?.default).toBe("block");
    expect(settings["secretGuard.hook.autoEnable"]?.default).toBe(true);
  });

  it("« VS Code 1.133 ou plus récent » in the manifest", () => {
    expect(manifest.engines.vscode).toBe("^1.133.0");
    expect(manifest.description).toContain(
      "Claude Code, Codex et GitHub Copilot",
    );
  });

  it("« réglage fait avec xSOM, pas une option à cocher » : no rule setting or editor", () => {
    expect(
      Object.keys(manifest.contributes.configuration.properties).sort(),
    ).toEqual(["secretGuard.hook.autoEnable", "secretGuard.mode"]);
    const commands = manifest.contributes.commands.map(
      (command) => command.command,
    );
    // Asking xSOM for a tuning, or importing a file xSOM signed (offline
    // workstations): nothing that composes or edits a rule.
    expect(
      commands.filter((command) => /rule|pack|regle|réglage/iu.test(command)),
    ).toEqual(["secretGuard.requestRulesPack", "secretGuard.importRulesPack"]);
  });
});
