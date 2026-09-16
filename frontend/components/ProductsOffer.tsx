"use client";

/**
 * La page des produits.
 *
 * Les deux produits vivaient dans une section d'ancre de l'accueil, et le menu y
 * renvoyait par un `#`. Deux conséquences : un visiteur qui cherchait ce qu'on propose
 * atterrissait au milieu d'une page qui parle d'abord des risques, et la plateforme s'y
 * réduisait à une ligne posée sous l'extension. Ils ont maintenant une page, et le même
 * traitement : ce que le produit garde, à quel moment, et ce qu'on obtient sans nous
 * parler.
 *
 * Les deux aperçus sont des **illustrations**, pas des captures : ils montrent la forme
 * d'une décision, pas un relevé. La page le dit sur chacun, et la borne de chaque
 * produit est écrite sous son bouton plutôt qu'en bas de page.
 */

import Image from "next/image";
import Link from "next/link";

import { Wordmark, XsomMark } from "@/components/brand";
import { GUARD_COPY } from "@/components/guard-copy";
import {
  GUARD_HOME_COPY,
  type GuardHomeCopy,
} from "@/components/guard-home-copy";
import { GuardNav } from "@/components/GuardNav";
import { SignalPreferences } from "@/design-system/react";
import { useT } from "@/lib/i18n";

// Les dimensions naturelles des deux captures. `next/image` les exige pour
// réserver la place avant le chargement ; une valeur fausse ferait sauter la mise
// en page à l'arrivée de l'image.
const PANNEAU = { width: 958, height: 1110 };
const CONSOLE = { width: 2880, height: 2600 };

/** Le poste de travail : ce qui part du clavier, avant d'atteindre le modèle. */
function SecretGuard({ copy }: { copy: GuardHomeCopy }) {
  return (
    <article className="guard-product-feature">
      <div className="guard-product-feature__copy reveal" data-delay="1">
        <p className="guard-product-feature__tag">
          <span aria-hidden="true" />
          {copy.extensionTag}
        </p>
        <h2>{copy.extensionTitle}</h2>
        <p className="guard-product-feature__lead">{copy.extensionIntro}</p>
        <p>{copy.extensionBody}</p>
        <p className="guard-product-feature__hosts">{copy.extensionHosts}</p>
        <ul>
          {copy.extensionFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <Link href="/extension" className="guard-button">
          {copy.extensionAction}
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="guard-product-feature__note">
          <span className="guard-product-feature__price">{copy.featured}</span>
          {copy.extensionNote}
        </p>
      </div>
      <figure className="guard-product-shot reveal" data-delay="2">
        <Image
          src="/signal-media/secret-guard-panneau.png"
          alt={copy.extensionShotAlt}
          width={PANNEAU.width}
          height={PANNEAU.height}
          sizes="(max-width: 800px) 100vw, 46vw"
        />
        <figcaption>{copy.extensionShotCaption}</figcaption>
      </figure>
    </article>
  );
}

/** La passerelle : ce que l'agent fait, une fois le prompt parti. */
function Platform({ copy }: { copy: GuardHomeCopy }) {
  return (
    <article className="guard-product-feature">
      <div className="guard-product-feature__copy reveal" data-delay="1">
        <p className="guard-product-feature__tag">
          <span aria-hidden="true" />
          {copy.platformTag}
        </p>
        <h2>{copy.platformTitle}</h2>
        <p className="guard-product-feature__lead">{copy.platformIntro}</p>
        <p>{copy.platformBody}</p>
        <ul>
          {copy.platformFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        <Link href="/signup" className="guard-button">
          {copy.platformAction}
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/saas" className="guard-link guard-product-feature__learn">
          {copy.platformLearn}
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="guard-product-feature__note">{copy.platformNote}</p>
      </div>
      <figure className="guard-product-shot reveal" data-delay="2">
        <Image
          src="/signal-media/ai-guard-console.png"
          alt={copy.platformShotAlt}
          width={CONSOLE.width}
          height={CONSOLE.height}
          sizes="(max-width: 800px) 100vw, 46vw"
        />
        <figcaption>{copy.platformShotCaption}</figcaption>
      </figure>
    </article>
  );
}

export function ProductsOffer() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  const home = GUARD_HOME_COPY[lang];
  return (
    <main className="guard-landing guard-home">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand">
            <XsomMark />
            <Wordmark />
          </Link>
          <GuardNav />
        </div>
      </header>

      <section
        className="guard-home-section guard-products guard-products-page guard-wrap"
        aria-labelledby="products-heading"
      >
        <div className="guard-home-heading reveal">
          <p className="guard-kicker">{home.productsKicker}</p>
          <h1 id="products-heading">{home.productsTitle}</h1>
          <p>{home.productsIntro}</p>
        </div>
        <SecretGuard copy={home} />
        <Platform copy={home} />
        <aside className="guard-glossary-link reveal">
          <span className="guard-glossary-link__icon" aria-hidden="true">
            Aa
          </span>
          <div>
            <h3>{home.glossaryTitle}</h3>
            <p>{home.glossaryBody}</p>
          </div>
          <Link href="/menaces">
            {home.glossaryAction}
            <span aria-hidden="true">↗</span>
          </Link>
        </aside>
      </section>

      <footer className="guard-footer">
        <div className="guard-wrap">
          <div className="brand">
            <XsomMark />
            <Wordmark />
          </div>
          <p>{copy.footer}</p>
          <Link href="/evidence">{copy.evidence}</Link>
          <a href="https://www.xsom.fr" target="_blank" rel="noreferrer">
            {copy.cabinet} ↗
          </a>
          <details>
            <summary>{lang === "fr" ? "Affichage" : "Display"}</summary>
            <SignalPreferences lang={lang} />
          </details>
        </div>
      </footer>
    </main>
  );
}
