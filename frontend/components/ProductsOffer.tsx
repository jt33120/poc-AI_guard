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

/** Le poste de travail : ce qui part du clavier, avant d'atteindre le modèle. */
function SecretGuard({ copy }: { copy: GuardHomeCopy }) {
  return (
    <article className="guard-product-feature">
      <div className="guard-product-feature__copy">
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
      <div className="guard-product-preview" aria-label={copy.preview}>
        <div className="guard-product-preview__bar">
          <span aria-hidden="true">⌘</span>
          <strong>AI Guard / VS Code</strong>
          <span>{copy.preview}</span>
        </div>
        <div className="guard-product-preview__editor">
          <div>
            <span aria-hidden="true">01</span>
            <p>{copy.previewPrompt}</p>
          </div>
          <div>
            <span aria-hidden="true">02</span>
            <code>
              API_KEY = <mark>{copy.previewValue}</mark>
            </code>
          </div>
          <div>
            <span aria-hidden="true">03</span>
            <span
              className="guard-product-preview__cursor"
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="guard-product-preview__decision">
          <span className="guard-product-preview__alert" aria-hidden="true">
            !
          </span>
          <div>
            <span>{copy.previewSecret}</span>
            <strong>{copy.previewDecision}</strong>
            <p>{copy.previewDetail}</p>
          </div>
        </div>
        <p className="guard-product-preview__foot">{copy.previewLocal}</p>
      </div>
    </article>
  );
}

/** La passerelle : ce que l'agent fait, une fois le prompt parti. */
function Platform({ copy }: { copy: GuardHomeCopy }) {
  return (
    <article className="guard-product-feature">
      <div className="guard-product-feature__copy">
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
        <Link href="/saas" className="guard-button">
          {copy.platformAction}
          <span aria-hidden="true">↗</span>
        </Link>
        <p className="guard-product-feature__note">{copy.platformNote}</p>
      </div>
      <div className="guard-product-preview" aria-label={copy.preview}>
        <div className="guard-product-preview__bar">
          <span aria-hidden="true">⌘</span>
          <strong>{copy.consolePreview}</strong>
          <span>{copy.preview}</span>
        </div>
        <div className="guard-product-preview__editor">
          <div>
            <span aria-hidden="true">01</span>
            <p>{copy.consoleRequest}</p>
          </div>
          <div>
            <span aria-hidden="true">02</span>
            <code>{copy.consoleRule}</code>
          </div>
          <div>
            <span aria-hidden="true">03</span>
            <span
              className="guard-product-preview__cursor"
              aria-hidden="true"
            />
          </div>
        </div>
        <div className="guard-product-preview__decision">
          <span className="guard-product-preview__alert" aria-hidden="true">
            !
          </span>
          <div>
            <span>{copy.consoleSignal}</span>
            <strong>{copy.consoleDecision}</strong>
            <p>{copy.consoleDetail}</p>
          </div>
        </div>
        <p className="guard-product-preview__foot">{copy.consoleFoot}</p>
      </div>
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
        <div className="guard-home-heading">
          <p className="guard-kicker">{home.productsKicker}</p>
          <h1 id="products-heading">{home.productsTitle}</h1>
          <p>{home.productsIntro}</p>
        </div>
        <SecretGuard copy={home} />
        <Platform copy={home} />
        <aside className="guard-glossary-link">
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
