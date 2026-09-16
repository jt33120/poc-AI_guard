"use client";

/**
 * La page de téléchargement de Secret Guard.
 *
 * Elle existe parce que le produit en ligne ne disait rien de l'extension : le seul
 * chemin d'installation passait par un clone du dépôt et une compilation locale,
 * c'est-à-dire par aucun utilisateur réel.
 *
 * **Deux canaux, un seul artefact.** Le VSIX attaché à la dernière release GitHub
 * s'installe sans compte ; la Place de marché VS Code, elle, donne le clic unique et
 * la mise à jour automatique, mais exige un compte éditeur que ce prototype n'a pas
 * encore ouvert. Tant que `EXTENSION_ON_MARKETPLACE` vaut `false`, la page ne montre
 * pas un bouton qui mènerait à une fiche inexistante : elle dit pourquoi, et donne le
 * canal qui marche. Le jour de la publication, c'est cette constante qui bascule.
 *
 * **Les bornes sont sur la page, pas en bas de page.** Le cadenas de la barre d'état
 * est un indicateur et le verrou est ailleurs ; le hook Copilot demande une version
 * de VS Code que l'utilisateur n'a pas forcément ; un hook utilisateur se retire.
 * Une page de téléchargement qui tairait ces trois points vendrait une garantie que
 * `docs/secret-guard/ARCHITECTURE.md` refuse d'écrire.
 */

import Link from "next/link";
import Image from "next/image";

import { Wordmark, XsomMark } from "@/components/brand";
import {
  CONTACT_MAILTO,
  EXTENSION_MARKETPLACE_URL,
  EXTENSION_ON_MARKETPLACE,
  EXTENSION_VSIX_URL,
  GUARD_COPY,
} from "@/components/guard-copy";
import { SignalPreferences } from "@/design-system/react";
import { LanguageToggle, useT } from "@/lib/i18n";

export function ExtensionOffer() {
  const { lang } = useT();
  const copy = GUARD_COPY[lang];
  return (
    <main className="guard-landing">
      <header className="guard-header">
        <div className="guard-wrap guard-header__inner">
          <Link href="/" className="brand">
            <XsomMark />
            <Wordmark />
          </Link>
          <nav
            aria-label={
              lang === "fr" ? "Navigation principale" : "Main navigation"
            }
          >
            <Link href="/">{copy.saasBack}</Link>
            <Link href="/saas">{copy.saasKicker}</Link>
            <LanguageToggle />
            <Link href="/login" className="guard-button guard-button--small">
              {copy.signin}
              <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <section className="guard-saas-hero guard-wrap">
        <p className="guard-kicker">{copy.extKicker}</p>
        <h1>{copy.extTitle}</h1>
        <p className="guard-hero__intro">{copy.extIntro}</p>
        <div className="guard-ext-actions">
          <a className="guard-button" href={EXTENSION_VSIX_URL} download>
            {copy.extInstallVsix}
            <span aria-hidden="true">↓</span>
          </a>
          {EXTENSION_ON_MARKETPLACE ? (
            <a className="guard-link" href={EXTENSION_MARKETPLACE_URL}>
              {copy.extInstallMarket}
              <span aria-hidden="true">↗</span>
            </a>
          ) : null}
        </div>
        {EXTENSION_ON_MARKETPLACE ? null : (
          <p className="guard-saas-open">{copy.extMarketSoon}</p>
        )}
      </section>

      <section className="guard-who guard-wrap" aria-labelledby="ext-plans">
        <div className="guard-section-heading">
          <h2 id="ext-plans">{copy.extPlansTitle}</h2>
        </div>
        <div className="guard-paths">
          <article className="guard-path" id="individual">
            <p className="guard-path__tag">{copy.extFreeLabel}</p>
            <h3>{copy.extFreeTitle}</h3>
            <p>{copy.extFreeBody}</p>
            <a className="guard-link" href="#ext-steps">{copy.extStepsTitle} ↓</a>
            <p className="guard-path__note">{copy.extFreeNote}</p>
          </article>
          <article className="guard-path" id="enterprise">
            <p className="guard-path__tag">{copy.extEnterpriseLabel}</p>
            <h3>{copy.extEnterpriseTitle}</h3>
            <p>{copy.extEnterpriseBody}</p>
            <a className="guard-button" href={CONTACT_MAILTO}>{copy.extEnterpriseAction} ↗</a>
            <p className="guard-path__note">{copy.extEnterpriseNote}</p>
            <a className="guard-link" href="https://learn.chatgpt.com/fr-FR/docs/hooks#hooks-gérés-définis-dans-requirementstoml" target="_blank" rel="noreferrer">{copy.extEnterpriseDocs} ↗</a>
          </article>
        </div>
      </section>

      <section className="guard-start guard-wrap" aria-labelledby="ext-steps">
        <div className="guard-section-heading">
          <h2 id="ext-steps">{copy.extStepsTitle}</h2>
        </div>
        <ol className="guard-start__steps guard-ext-steps">
          {copy.extSteps.map((etape, index) => (
            <li key={etape.title}>
              <span className="guard-step-number">0{index + 1}</span>
              <div>
                <h3>{etape.title}</h3>
                <p>{etape.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guard-gateway guard-wrap" aria-labelledby="ext-hosts">
        <h2 id="ext-hosts">{copy.extHostsTitle}</h2>
        <p>{copy.extHostsBody}</p>
        <ul className="guard-ext-hosts">
          {copy.extHosts.map((hote) => (
            <li key={hote}>
              {hote === "Claude Code" ? (
                <Image
                  className="guard-ext-hosts__logo"
                  src="/claude-ai-icon.webp"
                  width={28}
                  height={28}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              {hote}
            </li>
          ))}
        </ul>
      </section>

      <section className="guard-gateway guard-wrap" aria-labelledby="ext-check">
        <h2 id="ext-check">{copy.extCheckTitle}</h2>
        <p>{copy.extCheckBody}</p>
      </section>

      <section className="guard-gateway guard-wrap" aria-labelledby="ext-local">
        <h2 id="ext-local">{copy.extLocalTitle}</h2>
        <p>{copy.extLocalBody}</p>
        <h3 className="guard-ext-limits__title">{copy.extLimitsTitle}</h3>
        <ul className="guard-ext-limits">
          {copy.extLimits.map((borne) => (
            <li key={borne}>
              <span aria-hidden="true">↗</span>
              {borne}
            </li>
          ))}
        </ul>
        <p className="guard-start__note">
          <span className="guard-poc-label">{copy.poc}</span>
          {copy.saasNote}
        </p>
      </section>

      <footer className="guard-footer">
        <div className="guard-wrap">
          <div className="brand">
            <XsomMark />
            <Wordmark />
          </div>
          <p>{copy.footer}</p>
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
