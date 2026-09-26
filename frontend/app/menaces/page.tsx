import type { Metadata } from "next";

import { ThreatGlossary } from "@/components/ThreatGlossary";
import { getLang } from "@/lib/lang";
import { GLOSSARY_COPY } from "@/lib/threat-glossary";
import "../guard-landing.css";
import "../threat-glossary.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = GLOSSARY_COPY[await getLang()];
  return { title: copy.title, description: copy.description };
}

export default function ThreatGlossaryPage() {
  return <ThreatGlossary />;
}
