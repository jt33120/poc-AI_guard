"use client";

/**
 * Le menu, écrit une seule fois.
 *
 * Il portait quatre entrées, dont deux ancres de l'accueil : un visiteur arrivé sur
 * `/menaces` ou `/extension` y lisait « Nos usages » et se faisait renvoyer ailleurs
 * pour un simple défilement. Deux entrées suffisent à dire ce que le site contient :
 * ce qu'on propose, et le vocabulaire pour comprendre pourquoi. Le périmètre et les
 * preuves restent en pied de page, où on les cherche quand on les cherche.
 *
 * Une seule définition, partagée par tous les en-têtes publics. Chaque page portait sa
 * copie du menu, avec des entrées différentes : elles divergeaient déjà, et rien ne
 * l'aurait signalé.
 *
 * La classe `guard-nav__link` n'est pas décorative : la feuille de style masque le
 * premier lien du menu sous 1100 px, une règle héritée du temps où ce premier lien
 * était un « Retour à l'accueil » que la marque disait déjà. Sur deux entrées utiles,
 * elle en supprimerait une.
 */

import Link from "next/link";

import { GUARD_COPY } from "@/components/guard-copy";
import { GUARD_HOME_COPY } from "@/components/guard-home-copy";
import { LanguageToggle, useT } from "@/lib/i18n";

export function GuardNav() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  const home = GUARD_HOME_COPY[lang];
  return (
    <nav
      aria-label={lang === "fr" ? "Navigation principale" : "Main navigation"}
    >
      <Link className="guard-nav__link" href="/produits">
        {home.navProducts}
      </Link>
      <Link className="guard-nav__link" href="/menaces">
        {home.navGlossary}
      </Link>
      <LanguageToggle />
      <Link href="/login" className="guard-button guard-button--small">
        {copy.signin}
        <span aria-hidden="true">↗</span>
      </Link>
    </nav>
  );
}
