"use client";

import { GUARD_OFFERS_COPY } from "@/components/guard-offers-copy";
import { useT } from "@/lib/i18n";
import { CONTACT_MAILTO } from "@/components/guard-copy";
import { DeveloperPublicShell } from "./DeveloperPublicShell";

const COPY = {
  fr: {
    kicker: "XSOM CONSULTING SASU · ÉDITEUR FRANÇAIS",
    title: "Un produit de sécurité doit aussi avoir un responsable.",
    intro: "Developer Guard est édité, contracté, facturé et supporté par xSOM Consulting SASU. La promesse porte sur un périmètre opéré et documenté, jamais sur une sécurité absolue.",
    identity: "RCS Bordeaux 498 029 289 · TVA FR80498029289 · Arcachon, France",
    commitmentTitle: "Quatre engagements à contractualiser.",
    commitmentIntro: "Chaque offre sépare le droit d’usage, le produit livré, la maintenance et la responsabilité.",
    commitments: [
      ["01", "Licence claire", "Secret Guard Local reste gratuit avec un droit d’usage explicite. Developer Guard est fourni par souscription B2B."],
      ["02", "Périmètre publié", "Le contrat précisera les hôtes, versions, systèmes et limites. Une cellule non qualifiée n’est pas vendue comme une protection."],
      ["03", "Maintenance sécurité", "Les vulnérabilités, correctifs, versions et artefacts de livraison sont traités dans un processus documenté."],
      ["04", "Responsabilité xSOM", "Le contrat définit support, conformité à la documentation, recours et responsabilité de xSOM sur le périmètre souscrit."],
    ],
    documentsTitle: "Le dossier qui accompagne une souscription.",
    documents: [
      ["Licence Secret Guard Local", "Droit d’installer et d’utiliser l’offre gratuite, avec ses limites."],
      ["Conditions Developer Guard B2B", "Périmètre, garantie de conformité documentaire, réversibilité, données et responsabilité."],
      ["Politique support & maintenance", "Canal de support, versions couvertes, traitement des incidents et éventuel SLA."],
      ["Politique vulnérabilités", "Signalement, avis de sécurité, correctifs et preuves de chaîne de livraison."],
    ],
    boundaryTitle: "Ce que xSOM assume. Ce qui reste visible.",
    assumed: ["La conformité substantielle aux documents contractuels sur le périmètre souscrit.", "La maintenance et les correctifs selon le niveau de service acheté.", "Le traitement des preuves et données dans le cadre contractuel applicable."],
    limits: ["Aucune détection de menace n’est exhaustive.", "Un contrôle non raccordé ou non qualifié ne devient pas une garantie.", "Les fournisseurs d’agents, les postes et les données du client gardent leurs propres responsabilités."],
    ctaTitle: "Recevoir le dossier de pilote.",
    ctaBody: "Avant l’activation, xSOM partage le périmètre, les documents contractuels, les flux et les critères de réussite du pilote.",
    cta: "Demander le dossier xSOM",
  },
  en: {
    kicker: "XSOM CONSULTING SASU · FRENCH PUBLISHER",
    title: "A security product also needs an accountable publisher.",
    intro: "Developer Guard is published, contracted, billed and supported by xSOM Consulting SASU. The commitment covers a documented operated scope, never absolute security.",
    identity: "Bordeaux Trade Register 498 029 289 · VAT FR80498029289 · Arcachon, France",
    commitmentTitle: "Four commitments to put in writing.",
    commitmentIntro: "Each offer separates usage rights, delivered product, maintenance and liability.",
    commitments: [
      ["01", "Clear licence", "Secret Guard Local stays free with explicit usage rights. Developer Guard is provided under a B2B subscription."],
      ["02", "Published scope", "The contract will specify hosts, versions, systems and limits. An unqualified cell is never sold as protection."],
      ["03", "Security maintenance", "Vulnerabilities, fixes, versions and delivery artifacts follow a documented process."],
      ["04", "xSOM accountability", "The contract defines support, documentation conformity, remedies and xSOM's liability for the subscribed scope."],
    ],
    documentsTitle: "The subscription pack.",
    documents: [
      ["Secret Guard Local licence", "The right to install and use the free offer, with its limits."],
      ["Developer Guard B2B terms", "Scope, documentation conformity warranty, reversibility, data and liability."],
      ["Support & maintenance policy", "Support channel, covered versions, incident handling and any SLA."],
      ["Vulnerability policy", "Reporting, security advisories, fixes and software supply-chain evidence."],
    ],
    boundaryTitle: "What xSOM owns. What stays visible.",
    assumed: ["Substantial conformity with contractual documents for the subscribed scope.", "Maintenance and fixes according to the purchased service level.", "Processing evidence and data within the applicable contractual frame."],
    limits: ["No threat detection is exhaustive.", "An unconnected or unqualified control does not become a warranty.", "Agent providers, workstations and client data retain their own responsibilities."],
    ctaTitle: "Request the pilot pack.",
    ctaBody: "Before activation, xSOM shares the scope, contractual documents, flows and pilot success criteria.",
    cta: "Request the xSOM pack",
  },
} as const;

export function DeveloperTrust() {
  const { lang } = useT();
  const copy = COPY[lang];
  const offers = GUARD_OFFERS_COPY[lang];
  const documents = ["LICENCE-SECRET-GUARD-LOCAL", "CONDITIONS-DEVELOPER-GUARD-B2B", "POLITIQUE-SUPPORT-MAINTENANCE", "POLITIQUE-VULNERABILITES"];
  return (
    <DeveloperPublicShell current="trust">
      <main data-testid="developer-trust">
        <section className="developer-page-hero guard-wrap" aria-labelledby="trust-heading">
          <p className="guard-kicker">{copy.kicker}</p>
          <h1 id="trust-heading">{copy.title}</h1>
          <p>{copy.intro}</p>
          <p className="developer-hypothesis">{copy.identity}</p>
        </section>
        <section className="developer-section guard-wrap" aria-labelledby="commitments-heading">
          <header className="developer-section__heading"><p>01 / COMMITMENT</p><h2 id="commitments-heading">{copy.commitmentTitle}</h2><p>{copy.commitmentIntro}</p></header>
          <div className="developer-levels developer-trust-grid">{copy.commitments.map(([number, title, body]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
        </section>
        <section className="developer-section developer-section--tint" aria-labelledby="documents-heading"><div className="guard-wrap">
          <header className="developer-section__heading"><p>02 / CONTRACT PACK</p><h2 id="documents-heading">{copy.documentsTitle}</h2><p>{lang === "fr" ? "Projets de travail v0.1, à finaliser avant signature. Aucun SLA chiffré, certificat ou garantie d’assurance n’est annoncé ici. Les engagements applicables seront ceux du dossier signé." : "Working drafts v0.1, to finalise before signature. No quantified SLA, certification or insurance cover is claimed here. Applicable commitments will be those of the signed agreement."}</p></header>
          <div className="developer-hosts developer-trust-grid">{copy.documents.map(([title, body], index) => <article key={title}><h3>{title}</h3><p>{body}</p><a className="guard-link" href={`/contracts/${documents[index]}.md`} download>{lang === "fr" ? "Télécharger le projet (Markdown)" : "Download draft (French Markdown)"} ↓</a></article>)}</div>
        </div></section>
        <section className="developer-section guard-wrap" aria-labelledby="sovereignty-heading"><header className="developer-section__heading"><p>{lang === "fr" ? "SOUVERAINETÉ & TRANSPARENCE" : "SOVEREIGNTY & TRANSPARENCY"}</p><h2 id="sovereignty-heading">{offers.sovereigntyTitle}</h2><p>{offers.sovereigntyBody}</p></header></section>
        <section className="developer-section guard-wrap developer-conditions" aria-labelledby="boundaries-heading">
          <article><h2 id="boundaries-heading">{copy.boundaryTitle}</h2><ul>{copy.assumed.map((item) => <li key={item}>{item}</li>)}</ul></article>
          <article><h2>{lang === "fr" ? "Limites contractuelles" : "Contractual limits"}</h2><ul>{copy.limits.map((item) => <li key={item}>{item}</li>)}</ul></article>
        </section>
        <section className="developer-section developer-cta guard-wrap" aria-labelledby="trust-cta-heading"><div><p>03 / PILOT PACK</p><h2 id="trust-cta-heading">{copy.ctaTitle}</h2><p>{copy.ctaBody}</p></div><a className="guard-button" href={CONTACT_MAILTO}>{copy.cta} ↗</a></section>
      </main>
    </DeveloperPublicShell>
  );
}
