import claudeCode from "@/public/signal-media/hosts/claude-code.png";
import codex from "@/public/signal-media/hosts/codex.png";
import githubCopilot from "@/public/signal-media/hosts/github-copilot.png";

/** Les assistants pris en charge : des noms de produits, identiques dans les deux langues. */
export const HOSTS = [
  { id: "github-copilot", name: "GitHub Copilot", logo: githubCopilot },
  { id: "claude-code", name: "Claude Code", logo: claudeCode },
  { id: "codex", name: "Codex", logo: codex },
] as const;
