import type { Metadata } from "next";
import { DeveloperLanding } from "@/components/developer/DeveloperLanding";
import "../guard-landing.css";
import "../developer-guard.css";

export const metadata: Metadata = { title: "Developer Guard", description: "La gouvernance française des agents de code, éditée par xSOM Consulting. Commencez gratuitement et découvrez le cadre Équipe pendant 90 jours." };
export default function DevelopersPage() { return <DeveloperLanding />; }
