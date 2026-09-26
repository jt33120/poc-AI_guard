import type { Metadata } from "next";

import { ExtensionOffer } from "@/components/ExtensionOffer";
import "../guard-landing.css";
import "../guard-home.css";

export const metadata: Metadata = {
  title: "Secret Guard, l’extension",
  description:
    "Protection locale des prompts pour GitHub Copilot, Claude Code et Codex. Le secret est arrêté sur votre machine, avant l’envoi.",
};

export default function ExtensionPage() {
  return <ExtensionOffer />;
}
