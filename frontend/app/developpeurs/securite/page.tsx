import type { Metadata } from "next";
import { DeveloperSecurity } from "@/components/developer/DeveloperSecurity";
import "../../guard-landing.css";
import "../../developer-guard.css";

export const metadata: Metadata = { title: "Sécurité & preuves · Developer Guard", description: "Flux, préconditions, limites et couverture générée de Developer Guard." };
export default function DeveloperSecurityPage() { return <DeveloperSecurity />; }
