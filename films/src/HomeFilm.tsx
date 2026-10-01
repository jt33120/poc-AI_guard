import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Flash, Grade, Letters, Line, Reel, Scrim, clamp, enter, leave, useTime, type Shot } from "./kit";
import { Leaks, Mesh } from "./overlays";
import "./titles.css";

export const HOME_SECONDS = 15;

/**
 * Four acts, one per idea: the office adopting AI, the code it exposes, the network brought
 * under control, the business district sealed under the mesh. Cuts sit on the titles' beats.
 */
export const HOME_SHOTS: Shot[] = [
  { clip: "6803584", at: 0, from: 9, focus: 0.55, exposure: 0.92 },
  { clip: "34279721", at: 3.05, from: 0.4, focus: 0.4, exposure: 0.95, push: 0.08 },
  { clip: "1085656", at: 6.8, from: 4, focus: 0.5, exposure: 0.9 },
  { clip: "20670675", at: 10.9, from: 24, focus: 0.5, exposure: 0.95, push: 0.04 },
];

/** The burned-in words, per site language. Keep them in step with `HOME_HERO_MEDIA.label`. */
const COPY = {
  fr: {
    teams: "Vos équipes", adopt: "adoptent l’IA.",
    assets: "Secrets, données, actions d’agents :", exposed: "exposés.",
    controls: [["Détecter", "les secrets"], ["Bloquer", "les actions à risque"], ["Tracer", "chaque décision"]],
    layer: "La couche cybersécurité", usage: "de vos usages IA.", offer: "Logiciels · Conseil",
  },
  en: {
    teams: "Your teams", adopt: "embrace AI.",
    assets: "Secrets, data, agent actions:", exposed: "exposed.",
    controls: [["Detect", "secrets"], ["Block", "risky actions"], ["Trace", "every decision"]],
    layer: "The cybersecurity layer", usage: "for every AI use case.", offer: "Software · Consulting",
  },
} as const;
export type Lang = keyof typeof COPY;

/** A control verb lands large and sharp, then dims to blue when the next one arrives. */
function Slam({ t, at, dim, out, verb, object }: { t: number; at: number; dim?: number; out: number; verb: string; object: string }) {
  const shown = enter(t, at, 0.42);
  const exit = leave(t, out, 0.34);
  const dimmed = dim === undefined ? 0 : clamp((t - dim) / 0.3);
  const channel = (from: number, to: number) => Math.round(from + (to - from) * dimmed);
  return (
    <div
      className="slam"
      style={{
        opacity: shown * (1 - exit),
        transform: `translateX(${-exit * 90}px) scale(${1.14 - 0.14 * shown})`,
        filter: `blur(${(1 - shown) * 16}px)`,
      }}
    >
      <b style={{ color: `rgb(${channel(245, 111)},${channel(248, 182)},${channel(255, 255)})` }}>{verb}</b>
      <i>{object}</i>
    </div>
  );
}

function Titles({ lang }: { lang: Lang }) {
  const t = useTime();
  const copy = COPY[lang];
  const [detect, block, trace] = copy.controls;
  return (
    <div className="film home">
      <Scrim t={t} at={0} out={2.7} className="scrim--top" />
      <section className="beat beat--one">
        <div className="stack">
          <Line t={t} at={0.2} out={2.45} className="kicker">{copy.teams}</Line>
          <Line t={t} at={0.34} out={2.5} className="title">{copy.adopt}</Line>
        </div>
      </section>

      <Scrim t={t} at={3.0} out={6.55} className="scrim--bottom" />
      <section className="beat beat--two">
        <div className="stack">
          <Line t={t} at={3.2} out={6.3} className="kicker">{copy.assets}</Line>
          <Letters t={t} at={3.55} out={6.35} className="title threat" text={copy.exposed} />
        </div>
      </section>

      <Scrim t={t} at={6.75} out={10.35} className="scrim--left" />
      <section className="beat beat--three">
        <div className="stack">
          <Slam t={t} at={6.95} dim={7.8} out={10.1} verb={detect[0]} object={detect[1]} />
          <Slam t={t} at={7.8} dim={8.65} out={10.16} verb={block[0]} object={block[1]} />
          <Slam t={t} at={8.65} out={10.22} verb={trace[0]} object={trace[1]} />
        </div>
      </section>

      <Scrim t={t} at={10.9} className="scrim--final" />
      <section className="beat beat--four">
        <div className="stack">
          <div className="rule" style={{ transform: `scaleX(${enter(t, 11.15, 0.55)})` }} />
          <Line t={t} at={11.25} className="title">{copy.layer}</Line>
          <Line t={t} at={11.4} className="title accent">{copy.usage}</Line>
          <Line t={t} at={12.05} className="sub">{copy.offer}</Line>
        </div>
      </section>

      <Flash t={t} at={3.4} className="flash--red" />
      <Flash t={t} at={10.95} className="flash--blue" />
    </div>
  );
}

/** The motion graphics between footage and titles: the leaks, then the mesh taking over. */
function Story() {
  const t = useTime();
  return (
    <AbsoluteFill>
      <Leaks t={t} at={3.25} out={6.6} />
      <Mesh t={t} at={6.75} sweep={1.5} level={0.5} out={10.5} />
      <Mesh t={t} at={10.95} sweep={1.1} level={0.42} />
    </AbsoluteFill>
  );
}

/** Footage, grade, motion graphics, titles, music; a short fade to black before the loop. */
export function HomeFilm({ lang }: { lang: Lang }) {
  const t = useTime();
  return (
    <AbsoluteFill style={{ backgroundColor: "#050d1b" }}>
      <Reel shots={HOME_SHOTS} seconds={HOME_SECONDS} />
      <Grade />
      <Story />
      <Titles lang={lang} />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: clamp((t - (HOME_SECONDS - 0.45)) / 0.45) }} />
      <Audio src={staticFile("score/home.wav")} />
    </AbsoluteFill>
  );
}
