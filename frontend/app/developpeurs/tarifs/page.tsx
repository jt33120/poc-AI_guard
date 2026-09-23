import type { Metadata } from "next";
import { DeveloperPricing } from "@/components/developer/DeveloperPricing";
import "../../guard-landing.css";
import "../../developer-guard.css";

export const metadata: Metadata = { title: "Offres & tarifs · Developer Guard", description: "Secret Guard gratuit, 90 jours de découverte Équipe et tarifs cibles Developer Guard : 24 € et 49 € HT par poste actif et par mois." };
export default function DeveloperPricingPage() { return <DeveloperPricing />; }
