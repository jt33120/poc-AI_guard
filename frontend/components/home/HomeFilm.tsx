"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HOME_HERO_MEDIA } from "@/components/guard-copy";
import { useT, type Lang } from "@/lib/i18n";
import { HOME_COPY } from "./home-copy";
import { ChevronDownIcon, MutedIcon, PauseIcon, PlayIcon, VolumeIcon } from "./icons";
import { glideTo, motionReduced } from "./motion";

/** `auto` suit les préférences de mouvement ; un clic du visiteur les emporte. */
type Intent = "auto" | "paused" | "playing";

/** Un film par langue du site : la vidéo titrée, son affiche et sa transcription. */
export type FilmMedia = Record<Lang, { mp4: string; poster: string; label: string }>;

/**
 * Le film d'ouverture, plein cadre. Il ne joue que visible, onglet au premier plan,
 * et jamais de lui-même quand le mouvement est réduit : dans ce cas rien n'est
 * téléchargé avant que le visiteur ne demande la lecture. L'accueil et la page des
 * produits le partagent, chacun avec son film et la section qui le suit.
 */
export function HomeFilm({ media = HOME_HERO_MEDIA, next = "#usages" }: { media?: FilmMedia; next?: string }) {
  const { lang } = useT();
  const film = media[lang];
  const copy = HOME_COPY[lang].film;
  const video = useRef<HTMLVideoElement>(null);
  const intent = useRef<Intent>("auto");
  const visible = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  const apply = useCallback(() => {
    const media = video.current;
    if (!media) return;
    const wanted = intent.current === "playing" || (intent.current === "auto" && !motionReduced());
    if (wanted && visible.current && !document.hidden) void media.play().catch(() => setPlaying(false));
    else media.pause();
  }, []);

  useEffect(() => {
    const media = video.current;
    if (!media) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(([entry]) => { visible.current = entry.isIntersecting; apply(); }, { threshold: 0.25 });
    observer.observe(media);
    preference.addEventListener("change", apply);
    window.addEventListener("signal-preference", apply);
    document.addEventListener("visibilitychange", apply);
    apply();
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", apply);
      window.removeEventListener("signal-preference", apply);
      document.removeEventListener("visibilitychange", apply);
      media.pause();
    };
  }, [apply, film.mp4]);

  const togglePlay = () => {
    intent.current = playing ? "paused" : "playing";
    apply();
  };
  const toggleSound = () => {
    const media = video.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
    if (!media.muted && media.paused) togglePlay();
  };

  return (
    <section id="home-film" className="home-film" aria-label={copy.label}>
      <video
        ref={video}
        className="home-film__video"
        src={film.mp4}
        poster={film.poster}
        muted
        playsInline
        loop
        preload="none"
        aria-label={film.label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="guard-wrap home-film__bar">
        <a className="home-film__next" href={next} onClick={glideTo}>{copy.next}<ChevronDownIcon /></a>
        <div className="home-film__controls">
          <button type="button" onClick={togglePlay} aria-label={playing ? copy.pause : copy.play} title={playing ? copy.pause : copy.play}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" onClick={toggleSound} aria-label={muted ? copy.unmute : copy.mute} title={muted ? copy.unmute : copy.mute}>
            {muted ? <MutedIcon /> : <VolumeIcon />}
          </button>
        </div>
      </div>
    </section>
  );
}
