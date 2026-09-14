"use client";

import { useEffect, useRef, useState } from "react";
import type { GuardHomeCopy } from "./guard-home-copy";

/** Decorative local video; both OS and site motion preferences take precedence. */
export function GuardHeroVideo({ copy }: { copy: GuardHomeCopy }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState(false);
  const manualPause = useRef(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let active = true;
    const sync = () => {
      const stop = media.matches || document.documentElement.dataset.reducedMotion === "true";
      setReduced(stop);
      if (stop || !visible || document.hidden || manualPause.current) { video.pause(); return; }
      if (!video.getAttribute("src")) video.src = "/signal-media/ai-guard-hero-v2.webm";
      void video.play().catch(() => { if (active) setPlaying(false); });
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(video);
    window.addEventListener("signal-preference", sync);
    media.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => { active = false; video.pause(); observer.disconnect(); window.removeEventListener("signal-preference", sync); media.removeEventListener("change", sync); document.removeEventListener("visibilitychange", sync); };
  }, []);

  const toggle = () => {
    const video = ref.current;
    if (!video || reduced) return;
    manualPause.current = !video.paused;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };

  return (
    <>
      <video ref={ref} className="guard-masthead__video" poster="/signal-media/ai-guard-hero-v2.png" muted playsInline loop preload="none" aria-hidden="true" tabIndex={-1} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />
      {!reduced && !failed && <button className="guard-masthead__video-control" type="button" aria-label={playing ? copy.videoPause : copy.videoPlay} onClick={toggle}><span aria-hidden="true">{playing ? "Ⅱ" : "▷"}</span></button>}
    </>
  );
}
