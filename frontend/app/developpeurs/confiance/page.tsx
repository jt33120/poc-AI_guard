import type { Metadata } from "next";
import { DeveloperTrust } from "@/components/developer/DeveloperTrust";
import "../../guard-landing.css";
import "../../developer-guard.css";

export const metadata: Metadata = {
  title: "Engagement xSOM · Developer Guard",
  description: "Éditeur, engagements, périmètre de service et dossier contractuel Developer Guard.",
};

export default function DeveloperTrustPage() { return <DeveloperTrust />; }
