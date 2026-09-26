"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useT } from "@/lib/i18n";
import claudeCode from "@/public/signal-media/hosts/claude-code.png";
import codex from "@/public/signal-media/hosts/codex.png";
import githubCopilot from "@/public/signal-media/hosts/github-copilot.png";
import screenshot from "@/public/signal-media/secret-guard-vscode.png";
import { HOME_COPY } from "./home-copy";

/** Les assistants pris en charge : des noms de produits, identiques dans les deux langues. */
const HOSTS = [
  { id: "github-copilot", name: "GitHub Copilot", logo: githubCopilot },
  { id: "claude-code", name: "Claude Code", logo: claudeCode },
  { id: "codex", name: "Codex", logo: codex },
] as const;

/**
 * Secret Guard, présenté comme un produit : la capture réelle de VS Code sous Windows
 * dans un portable dessiné en CSS, et devant, la marque de l'extension (le signe xSOM
 * sur sa tuile, comme l'icône publiée de l'extension).
 */
export function HomeSecretGuard() {
  const { lang } = useT();
  const copy = HOME_COPY[lang].secretGuard;
  return (
    <section id="secret-guard" className="home-sg" aria-labelledby="secret-guard-title">
      <div className="guard-wrap">
        <header className="home-sg__head">
          <p className="home-kicker" data-reveal>{copy.kicker}</p>
          <h2 id="secret-guard-title" className="home-title" data-reveal style={{ "--chars": copy.title.length } as CSSProperties}>
            {copy.title}
          </h2>
          <p className="home-sg__lead" data-reveal>{copy.lead}</p>
          <div className="home-sg__action" data-reveal>
            <Link className="guard-button" href="/extension">{copy.action} <span aria-hidden="true">↗</span></Link>
            <div className="home-sg__hosts">
              <span>{copy.hosts}</span>
              <ul>
                {HOSTS.map((host) => (
                  <li key={host.id}>
                    <span className="home-sg__host-logo" data-host={host.id}>
                      <Image src={host.logo} alt="" width={28} height={28} />
                    </span>
                    {host.name}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </header>

        <figure className="home-sg__device" data-reveal="device">
          <div className="home-laptop">
            <div className="home-laptop__lid">
              <div className="home-laptop__display">
                <div className="home-laptop__window">
                  <Image src={screenshot} alt={copy.imageAlt} sizes="(max-width: 900px) 90vw, 640px" placeholder="blur" />
                </div>
              </div>
            </div>
            <div className="home-laptop__base" aria-hidden="true"><span className="home-laptop__trackpoint" /></div>
          </div>
          <div className="home-sg__badge" aria-hidden="true">
            <span className="home-sg__tile">
              {/* The xSOM mark is served as a file, like in the brand block (see brand.tsx). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/xsom-mark.svg" alt="" width={64} height={64} />
            </span>
            <span className="home-sg__name">
              <strong>Secret Guard</strong>
              <small>{copy.badge}</small>
            </span>
          </div>
        </figure>

        <ol className="home-sg__benefits">
          {copy.features.map(([title, body], index) => (
            <li key={title} data-reveal style={{ transitionDelay: `${index * 90}ms` }}>
              <span className="home-sg__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
