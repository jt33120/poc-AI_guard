import type { Metadata } from "next";

import { ExtensionOffer } from "@/components/ExtensionOffer";
import "../guard-landing.css";
import "../guard-home.css";

export const metadata: Metadata = {
  title: "Secret Guard, l’extension | xSOM AI Guard",
  description:
    "Protection locale des prompts pour VS Code et Copilot, Claude Code, Codex et Windsurf. Le secret est arrêté sur votre machine, avant l’envoi.",
};

export default function ExtensionPage() {
  return <ExtensionOffer />;
}
