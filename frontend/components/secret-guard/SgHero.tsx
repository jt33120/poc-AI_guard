"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { EXTENSION_HERO_MEDIA } from "@/components/guard-copy";
import { DownloadIcon } from "@/components/home/icons";
import { glideTo, motionReduced } from "@/components/home/motion";
import { useT } from "@/lib/i18n";
import { HOSTS } from "./hosts";
import { SECRET_GUARD_COPY } from "./secret-guard-copy";

/**
 * L'ouverture : la promesse en deux lignes, les trois assistants, le téléchargement.
 * La vidéo d'ambiance ne joue que si le mouvement n'est pas réduit ; sinon, son
 * affiche suffit et rien n'est téléchargé.
 */
export function SgHero({ version }: { version: string }) {
  const { lang } = useT();
  const copy = SECRET_GUARD_COPY[lang].hero;
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const media = video.current;
    if (media && !motionReduced()) void media.play().catch(() => undefined);
  }, []);

  return (
    <section className="sg-hero" aria-labelledby="sg-title">
      <video
        ref={video}
        className="sg-hero__video"
        src={EXTENSION_HERO_MEDIA.webm}
        poster={EXTENSION_HERO_MEDIA.poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={copy.video}
      />
      <div className="guard-wrap sg-hero__inner">
        <p className="home-kicker">{copy.kicker}</p>
        <h1 id="sg-title" className="sg-hero__title">
          {copy.title[0]}<br /><span>{copy.title[1]}</span>
        </h1>
        <p className="sg-hero__lead">{copy.lead}</p>
        <div className="sg-hero__actions">
          <a className="guard-button" href="#telecharger" onClick={glideTo}>
            <DownloadIcon /> {copy.download} · v{version}
          </a>
          <a className="sg-hero__how" href="#fonctionnement" onClick={glideTo}>{copy.how}</a>
        </div>
        <div className="sg-hero__hosts">
          <p>{copy.hosts}</p>
          <ul>
            {HOSTS.map((host) => (
              <li key={host.id}>
                <span className="sg-logo" data-host={host.id}><Image src={host.logo} alt="" width={44} height={44} /></span>
                {host.name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
