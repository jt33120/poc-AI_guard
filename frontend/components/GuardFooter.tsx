"use client";

import Link from "next/link";
import { Wordmark, XsomMark } from "@/components/brand";
import { SignalPreferences } from "@/design-system/react";
import { useT } from "@/lib/i18n";
import "@/app/guard-footer.css";

export function GuardFooter() {
  const { lang } = useT();
  const fr = lang === "fr";
  return <footer className="studio-footer">
    <div className="guard-wrap">
      <div className="studio-footer__grid">
        <div className="studio-footer__identity">
          <Link href="/" className="brand" aria-label="xSOM AI Studio — Accueil"><XsomMark /><Wordmark /></Link>
          <p>{fr ? "Des outils et du conseil pour mieux protéger vos usages de l’IA." : "Tools and consulting to better protect your AI workflows."}</p>
          <a href="mailto:julian.talou@xsom.fr">julian.talou@xsom.fr ↗</a>
        </div>
        <nav aria-label={fr ? "Explorer le site" : "Explore the site"}>
          <h2>{fr ? "Explorer" : "Explore"}</h2>
          <Link href="/produits">{fr ? "Nos Produits" : "Our products"}</Link>
          <a href="https://www.xsom.fr" target="_blank" rel="noreferrer">{fr ? "Nos conseils" : "Our consulting"} ↗</a>
          <Link href="/menaces">{fr ? "Vos besoins" : "Your needs"}</Link>
        </nav>
        <nav aria-label={fr ? "Informations légales" : "Legal information"}>
          <h2>{fr ? "Informations légales" : "Legal information"}</h2>
          <Link href="/mentions-legales">{fr ? "Mentions légales" : "Legal notice"}</Link>
          <Link href="/confidentialite">{fr ? "Politique de confidentialité" : "Privacy policy"}</Link>
          <Link href="/cookies">{fr ? "Cookies et préférences" : "Cookies and preferences"}</Link>
          <Link href="/conditions-utilisation">{fr ? "Conditions d’utilisation" : "Terms of use"}</Link>
        </nav>
      </div>
      <div className="studio-footer__bottom">
        <p>© {new Date().getFullYear()} xSOM Consulting · xSOM AI Studio</p>
        <details><summary>{fr ? "Préférences d’affichage" : "Display preferences"}</summary><SignalPreferences lang={lang} /></details>
      </div>
    </div>
  </footer>;
}
