import Link from "next/link";
import type { Metadata } from "next";
import { XsomMark, Wordmark } from "@/components/brand";
import { Fonctionnement } from "@/components/Fonctionnement";
import { ProfilProvider } from "@/components/ProfilContext";
import { ThreatLedger } from "@/components/ThreatLedger";
import { LanguageToggle } from "@/lib/i18n";
import { serverT } from "@/lib/lang";

export function generateMetadata(): Metadata {
  const { lang } = serverT();
  const fr = lang === "fr";
  return {
    title: fr ? "Périmètre et preuves du POC" : "POC scope and evidence",
    description: fr
      ? "Le détail technique du prototype AI Guard : scénarios publiés, intégrations possibles, preuves et limites."
      : "The AI Guard prototype’s technical detail: published scenarios, possible integrations, evidence and limits.",
  };
}

/** The original evidence remains public, separate from the POC's first view. */
export default function EvidencePage() {
  const { lang } = serverT();
  const fr = lang === "fr";
  return (
    <main className="relative">
      <header className="site-header border-b border-white/10">
        <div className="wrap flex min-h-20 flex-wrap items-center justify-between gap-4 py-3">
          <Link href="/" className="brand">
            <XsomMark />
            <Wordmark />
          </Link>
          <div className="flex items-center gap-4">
            <LanguageToggle />
            <Link href="/" className="btn btn-ghost">
              {fr ? "Retour au POC" : "Back to the POC"}
            </Link>
          </div>
        </div>
      </header>
      <section className="section">
        <div className="wrap">
          <p className="eyebrow">
            {fr ? "Documentation du prototype" : "Prototype documentation"}
          </p>
          <h1 className="t-h2 mt-4">
            {fr
              ? "Le périmètre. Les preuves. Les limites."
              : "Scope. Evidence. Limits."}
          </h1>
          <p className="lead mt-4">
            {fr
              ? "Les contrôles dépendent de l’intégration choisie. Cette page conserve les scénarios publiés et le détail technique du POC."
              : "Controls depend on your integration. This page retains the POC’s published scenarios and technical details."}
          </p>
        </div>
      </section>
      <Fonctionnement />
      <ProfilProvider>
        <ThreatLedger />
      </ProfilProvider>
    </main>
  );
}
