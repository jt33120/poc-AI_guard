import { AbsoluteFill, Audio, staticFile } from "remotion";
import { Flash, Grade, Line, Reel, Scrim, clamp, enter, useTime, type Shot } from "./kit";
import type { Lang } from "./HomeFilm";
import "./titles.css";

export const PRODUCTS_SECONDS = 15;

/** The laptop, the servers, then the light between them: from laptop to server. */
const SHOTS: Shot[] = [
  { clip: "30357894", at: 0, from: 3, focus: 0.45, exposure: 0.9 },
  { clip: "7140928", at: 4, from: 0.5, focus: 0.5, exposure: 1.05, push: 0.07 },
  { clip: "8817471", at: 9.4, from: 6, focus: 0.5, exposure: 1, push: 0.09 },
];

/** The burned-in words, per site language. Keep them in step with `PRODUCTS_HERO_MEDIA.label`. */
const COPY = {
  fr: {
    device: "Sur le poste", protect: "Protéger", protectWhat: "ce que vos équipes envoient aux IA.",
    platform: "Dans votre infrastructure", control: "Contrôler", controlWhat: "chaque action de vos agents.",
    from: "Du poste", to: "au serveur.", range: "Nos produits de cybersécurité IA",
  },
  en: {
    device: "On the workstation", protect: "Protect", protectWhat: "what your teams send to AI.",
    platform: "In your infrastructure", control: "Control", controlWhat: "every action your agents take.",
    from: "From laptop", to: "to server.", range: "Our AI cybersecurity products",
  },
} as const;

function Titles({ lang }: { lang: Lang }) {
  const t = useTime();
  const copy = COPY[lang];
  return (
    <div className="film products">
      <Scrim t={t} at={0} out={3.75} className="scrim--right" />
      <section className="beat beat--device">
        <div className="stack">
          <Line t={t} at={0.25} out={3.45} className="kicker">{copy.device}</Line>
          <Line t={t} at={0.4} out={3.5} className="title product">{copy.protect}</Line>
          <Line t={t} at={0.85} out={3.55} className="sub">{copy.protectWhat}</Line>
        </div>
      </section>

      <Scrim t={t} at={4.0} out={8.75} className="scrim--left" />
      <section className="beat beat--platform">
        <div className="stack">
          <Line t={t} at={4.2} out={8.4} className="kicker">{copy.platform}</Line>
          <Line t={t} at={4.35} out={8.45} className="title product">{copy.control}</Line>
          <Line t={t} at={4.8} out={8.5} className="sub">{copy.controlWhat}</Line>
        </div>
      </section>

      <Flash t={t} at={9.4} className="flash" />

      <Scrim t={t} at={10.2} className="scrim--left" />
      <section className="beat beat--range">
        <div className="stack">
          <div className="rule" style={{ transform: `scaleX(${enter(t, 10.45, 0.55)})` }} />
          <Line t={t} at={10.55} className="title">{copy.from}</Line>
          <Line t={t} at={10.7} className="title accent">{copy.to}</Line>
          <Line t={t} at={11.35} className="sub">{copy.range}</Line>
        </div>
      </section>
    </div>
  );
}

export function ProductsFilm({ lang }: { lang: Lang }) {
  const t = useTime();
  return (
    <AbsoluteFill style={{ backgroundColor: "#050d1b" }}>
      <Reel shots={SHOTS} seconds={PRODUCTS_SECONDS} />
      <Grade />
      <Titles lang={lang} />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: clamp((t - (PRODUCTS_SECONDS - 0.45)) / 0.45) }} />
      <Audio src={staticFile("score/products.wav")} />
    </AbsoluteFill>
  );
}
