"use client";

import Link from "next/link";
import { EXTENSION_VSIX_URL } from "@/components/guard-copy";
import { DownloadIcon } from "@/components/home/icons";
import type { SecretGuardRelease } from "@/lib/secret-guard-release";
import { useT } from "@/lib/i18n";
import { SECRET_GUARD_COPY } from "./secret-guard-copy";

/** Le fichier, sa version, et les trois gestes qui suivent. */
export function SgDownload({ release }: { release: SecretGuardRelease }) {
  const { lang } = useT();
  const copy = SECRET_GUARD_COPY[lang].download;
  return (
    <section id="telecharger" className="sg-download" aria-labelledby="sg-download-title">
      <div className="guard-wrap">
        <div className="sg-download__card" data-reveal>
          <div className="sg-download__brand">
            <span className="sg-tile">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xsom-mark.svg" alt="" width={64} height={64} />
            </span>
            <div>
              <p className="home-kicker">{copy.kicker}</p>
              <h2 id="sg-download-title">{copy.title}</h2>
              <p className="sg-download__version">
                {copy.version} <strong>{release.version}</strong>
                <span aria-hidden="true"> · </span>
                <a href={release.notes} target="_blank" rel="noreferrer">{copy.notes} ↗</a>
              </p>
            </div>
          </div>
          <div className="sg-download__cta">
            <a className="guard-button sg-download__button" href={EXTENSION_VSIX_URL}>
              <DownloadIcon /> {copy.button}
            </a>
            <p>{copy.requirement}</p>
          </div>
          <ol className="sg-download__steps">
            {copy.steps.map(([title, detail], index) => (
              <li key={title}>
                <span aria-hidden="true">{index + 1}</span>
                <strong>{title}</strong>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
          <Link className="sg-download__team" href="/produits#offres">{copy.team} <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>
  );
}
