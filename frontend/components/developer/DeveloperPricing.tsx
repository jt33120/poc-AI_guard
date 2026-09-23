"use client";

import { useT } from "@/lib/i18n";
import { GuardOffers, GuardPublisher, GuardOfferQuestions } from "@/components/GuardOffers";
import { PILOT_MAILTO } from "@/components/guard-offers-copy";
import { DeveloperPublicShell } from "./DeveloperPublicShell";

export function DeveloperPricing() {
  const { lang } = useT();
  return <DeveloperPublicShell current="pricing"><main>
    <section className="developer-page-hero developer-pricing-hero guard-wrap" aria-labelledby="pricing-heading">
      <p className="guard-kicker">{lang === "fr" ? "OFFRES & TARIFS · LANCEMENT" : "PLANS & PRICING · LAUNCH"}</p>
      <h1 id="pricing-heading">{lang === "fr" ? "Commencez librement. Grandissez avec xSOM." : "Start freely. Grow with xSOM."}</h1>
      <p>{lang === "fr" ? "La protection locale est gratuite. La valeur de l’offre d’équipe : des règles communes, des preuves utiles et un éditeur français qui accompagne leur mise en œuvre." : "Local protection is free. Team value comes from shared rules, useful evidence and a French publisher supporting their implementation."}</p>
    </section>
    <GuardOffers />
    <section className="developer-section developer-section--tint"><div className="guard-wrap developer-channels">
      <div><p className="guard-kicker">{lang === "fr" ? "VOTRE DÉCOUVERTE ÉQUIPE" : "YOUR TEAM DISCOVERY"}</p><h2>{lang === "fr" ? "90 jours pour décider." : "90 days to decide."}</h2></div>
      <ol>{(lang === "fr" ? ["Qualification : vos postes, vos assistants, vos dépôts et vos objectifs.", "Accord de pilote : jusqu’à 10 postes, périmètre, date de début et conditions écrits.", "Évaluation : contrôles actifs, faux refus, adoption et charge d’exploitation.", "Bilan : poursuivre sur devis ou arrêter, sans souscription automatique."] : ["Qualification: workstations, assistants, repositories and goals.", "Pilot agreement: up to 10 workstations, written scope, start date and terms.", "Evaluation: active controls, false blocks, adoption and operating effort.", "Review: continue on a quote or stop, with no automatic subscription."]).map((step, index) => <li key={step}><span>0{index + 1}</span>{step}</li>)}</ol>
    </div></section>
    <GuardOfferQuestions />
    <GuardPublisher />
    <section className="developer-section developer-cta guard-wrap"><div><p>{lang === "fr" ? "PARLONS DE VOTRE ÉQUIPE" : "LET’S TALK ABOUT YOUR TEAM"}</p><h2>{lang === "fr" ? "Évaluons votre premier périmètre." : "Let’s assess your first scope."}</h2><p>{lang === "fr" ? "Indiquez le nombre de développeurs, les assistants utilisés et vos systèmes. xSOM vous répond pour cadrer le pilote." : "Share your developer count, assistants and operating systems. xSOM will reply to scope the pilot."}</p></div><a className="guard-button" href={PILOT_MAILTO}>{lang === "fr" ? "Demander mes 90 jours" : "Request my 90 days"} ↗</a></section>
  </main></DeveloperPublicShell>;
}
