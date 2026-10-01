import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/** The site's own faces, copied into public/fonts by `npm run footage`. */
const FACES = [
  ["Saira", "saira-600-800.woff2", "600 800"],
  ["Source", "source-sans-3-latin-variable.woff2", "200 900"],
  ["Mono", "jetbrains-mono-500.woff2", "500"],
  ["Manrope", "manrope-latin-variable.woff2", "200 800"],
] as const;
const fontsReady = delayRender("Loading the site fonts");
Promise.all(FACES.map(([family, file, weight]) => new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight }).load()))
  .then((faces) => {
    faces.forEach((face) => document.fonts.add(face));
    continueRender(fontsReady);
  })
  .catch(cancelRender);

export const clamp = (x: number) => Math.min(1, Math.max(0, x));
export const outExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const inCubic = (x: number) => x ** 3;
/** 0 → 1 as an element arrives at `at` seconds. */
export const enter = (t: number, at: number, span: number) => outExpo(clamp((t - at) / span));
/** 0 → 1 as it leaves from `at` seconds; 0 forever when it never leaves. */
export const leave = (t: number, at: number | undefined, span: number) => (at === undefined ? 0 : inCubic(clamp((t - at) / span)));

/** The film's clock in seconds: every element is a pure function of it. */
export function useTime() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

/** One stock clip on the film's timeline: `at` on the film, `from` in the clip, both in seconds. */
export type Shot = {
  clip: string;
  at: number;
  from: number;
  /** Horizontal focal point, 0 (left) to 1 (right): what a portrait crop keeps. */
  focus?: number;
  /** Brightness, matched by eye so every shot sits at the site's navy level. */
  exposure?: number;
  /** How far the slow push-in goes over the shot. */
  push?: number;
};

function Clip({ shot, frames, fade }: { shot: Shot; frames: number; fade: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = 1.015 + (shot.push ?? 0.05) * (frame / frames);
  return (
    <AbsoluteFill style={{ opacity: fade ? clamp(frame / fade) : 1 }}>
      <OffthreadVideo
        src={staticFile(`footage/${shot.clip}.mp4`)}
        trimBefore={Math.round(shot.from * fps)}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${(shot.focus ?? 0.5) * 100}% 50%`,
          transform: `scale(${scale})`,
          filter: `brightness(${shot.exposure ?? 1}) contrast(1.06) saturate(0.8)`,
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * The shots end to end. Each one dissolves in over `dissolve` seconds from its `at`, over the
 * previous shot, which keeps playing underneath until the dissolve is done.
 */
export function Reel({ shots, seconds, dissolve = 0.3 }: { shots: Shot[]; seconds: number; dissolve?: number }) {
  const { fps } = useVideoConfig();
  const fade = Math.round(dissolve * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "#050d1b" }}>
      {shots.map((shot, index) => {
        const from = Math.round(shot.at * fps);
        const until = Math.round((shots[index + 1]?.at ?? seconds) * fps) + (index < shots.length - 1 ? fade : 0);
        return (
          <Sequence key={`${shot.clip}-${shot.at}`} from={from} durationInFrames={until - from}>
            <Clip shot={shot} frames={until - from} fade={index ? fade : 0} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

/**
 * The house grade over any footage: a cool navy tone, darker top and bottom edges for the
 * site's header and controls, a vignette and a fine moving grain, so clips from different
 * cameras read as one film.
 */
export function Grade({ grain = 0.05 }: { grain?: number }) {
  const frame = useCurrentFrame();
  const layer: CSSProperties = { position: "absolute", inset: 0 };
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...layer, background: "#123a6e", mixBlendMode: "soft-light", opacity: 0.55 }} />
      <div style={{ ...layer, background: "#0c1c33", mixBlendMode: "color", opacity: 0.18 }} />
      <div
        style={{
          ...layer,
          background: "linear-gradient(180deg, rgba(4,12,26,.42), rgba(4,12,26,0) 28%, rgba(4,12,26,0) 72%, rgba(4,12,26,.5))",
        }}
      />
      <div style={{ ...layer, background: "radial-gradient(ellipse 75% 70% at 50% 50%, rgba(3,10,22,0) 55%, rgba(3,10,22,.55))" }} />
      <svg style={{ ...layer, width: "100%", height: "100%", opacity: grain, mixBlendMode: "overlay" }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={Math.floor(frame / 2) % 97} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </AbsoluteFill>
  );
}

/** A line of text revealed through its own mask: it rises in, then rises out. */
export function Line({
  t,
  at,
  out,
  className,
  children,
}: {
  t: number;
  at: number;
  out?: number;
  className: string;
  children: ReactNode;
}) {
  const rise = (1 - enter(t, at, 0.62)) * 125 - leave(t, out, 0.38) * 125;
  return (
    <div className={`line ${className}`}>
      <span style={{ transform: `translateY(${rise}%)` }}>{children}</span>
    </div>
  );
}

/** The same mask, letter by letter, 50 ms apart. */
export function Letters({ t, at, out, className, text }: { t: number; at: number; out?: number; className: string; text: string }) {
  return (
    <div className={`line ${className}`}>
      <span style={{ transform: `translateY(${-leave(t, out, 0.38) * 125}%)` }}>
        {[...text].map((letter, index) => (
          <span key={index} style={{ display: "inline-block", transform: `translateY(${(1 - enter(t, at + index * 0.05, 0.5)) * 125}%)` }}>
            {letter}
          </span>
        ))}
      </span>
    </div>
  );
}

/** A full-frame shade behind one beat's words. */
export function Scrim({ t, at, out, className }: { t: number; at: number; out?: number; className: string }) {
  return <div className={`scrim ${className}`} style={{ opacity: clamp((t - at) / 0.4) * (1 - leave(t, out, 0.4)) }} />;
}

/** A short burst of light, peaking at `at`. */
export function Flash({ t, at, className }: { t: number; at: number; className: string }) {
  const d = t - at;
  return <div className={`flash ${className}`} style={{ opacity: d < 0 ? clamp(1 + d / 0.08) : clamp(1 - d / 0.35) ** 2 }} />;
}
