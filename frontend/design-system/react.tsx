"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { initSignal, normalizeVerdict } from "./signal.js";

export type SignalLang = "fr" | "en";
type BaseProps = {
  lang?: SignalLang;
  className?: string;
  mode?: "demo" | "live";
};
export type SignalAuditEvent = {
  id: string;
  hash?: string;
  previousHash?: string;
  label?: string;
  verdict?: string;
  time?: string;
};

// Executed before first paint by the host layout. The same storage format is used by the static site.
export { SIGNAL_BOOTSTRAP_SCRIPT } from "./bootstrap";

export function SignalBootstrap() {
  useEffect(() => initSignal(), []);
  return null;
}

function Diagram({
  tag,
  lang = "fr",
  className,
  mode = "live",
  attributes = {},
  children,
  onSelect,
}: {
  tag: string;
  lang?: SignalLang;
  className?: string;
  mode?: string;
  attributes?: Record<string, string | undefined>;
  children: string;
  onSelect?: (id: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    initSignal();
    const el = ref.current;
    if (!el || !onSelect) return;
    const select = (event: Event) =>
      onSelect((event as CustomEvent<SignalAuditEvent>).detail.id);
    el.addEventListener("signal-select", select);
    return () => el.removeEventListener("signal-select", select);
  }, [onSelect, lang, tag]);
  return createElement(
    tag,
    {
      // A language change replaces the progressive fallback too. Remount the
      // custom element so React cannot overwrite its upgraded light DOM.
      key: `${tag}:${lang}`,
      ref,
      lang,
      mode,
      className,
      ...attributes,
      suppressHydrationWarning: true,
    },
    children,
  );
}

export function AuthorizationFlow({
  lang = "fr",
  verdict = "hitl",
  interactive = false,
  mode = "live",
  className,
}: BaseProps & { verdict?: string; interactive?: boolean }) {
  return (
    <Diagram
      tag="signal-flow"
      lang={lang}
      mode={mode}
      className={className}
      attributes={{ verdict, interactive: interactive ? "" : undefined }}
    >
      {lang === "fr"
        ? "Agent → Guard → Policy → Outil. Le verdict du service fait autorité."
        : "Agent → Guard → Policy → Tool. The service verdict is authoritative."}
    </Diagram>
  );
}
export function AuditChain({
  lang = "fr",
  events,
  mode = "live",
  onSelect,
  className,
}: BaseProps & {
  events?: SignalAuditEvent[];
  onSelect?: (id: string) => void;
}) {
  return (
    <Diagram
      tag="signal-audit"
      lang={lang}
      mode={mode}
      className={className}
      attributes={{
        events: events === undefined ? undefined : JSON.stringify(events),
      }}
      onSelect={onSelect}
    >
      {lang === "fr"
        ? "Journal d’événements. Aucune vérification cryptographique n’est déduite de cette vue."
        : "Event log. This view does not imply cryptographic verification."}
    </Diagram>
  );
}
export function RiskMeter({
  lang = "fr",
  score,
  trust,
  mode = "live",
  className,
}: BaseProps & { score?: number | null; trust?: number | null }) {
  return (
    <Diagram
      tag="signal-risk"
      lang={lang}
      mode={mode}
      className={className}
      attributes={{
        score: score == null ? undefined : String(score),
        trust: trust == null ? undefined : String(trust),
      }}
    >
      {lang === "fr"
        ? "Risque et confiance. Le score ne vaut pas autorisation."
        : "Risk and trust. A score is not authorization."}
    </Diagram>
  );
}
export function SovereigntyMap({ lang = "fr", className }: BaseProps) {
  return (
    <Diagram tag="signal-sovereignty" lang={lang} className={className}>
      {lang === "fr"
        ? "Résidence des données, contrôle des clés et frontières de sortie."
        : "Data residency, key control and egress boundaries."}
    </Diagram>
  );
}
export function PolesLockin({ lang = "fr", className }: BaseProps) {
  return (
    <Diagram tag="signal-poles" lang={lang} className={className}>
      {lang === "fr"
        ? "Télécom & cybersécurité · IA & cloud souverain · Data & automatisation."
        : "Telecom & cybersecurity · AI & sovereign cloud · Data & automation."}
    </Diagram>
  );
}
export function MissionTimeline({ lang = "fr", className }: BaseProps) {
  return (
    <Diagram tag="signal-timeline" lang={lang} className={className}>
      {lang === "fr"
        ? "Cadrage → Build → Production → Run."
        : "Scope → Build → Production → Run."}
    </Diagram>
  );
}
export function SignalVideo({
  lang = "fr",
  variant = "guarded",
  className,
}: BaseProps & { variant?: "guarded" | "unguarded" }) {
  return (
    <Diagram
      tag="signal-video"
      lang={lang}
      className={className}
      attributes={{ variant, "asset-base": "/signal-media" }}
    >
      {lang === "fr"
        ? "Séquence illustrative : Agent → Guard → Policy → Outil."
        : "Illustrative sequence: Agent → Guard → Policy → Tool."}
    </Diagram>
  );
}
export function SignalPreferences({ lang = "fr", className }: BaseProps) {
  return (
    <Diagram tag="signal-preferences" lang={lang} className={className}>
      {lang === "fr"
        ? "Préférences d’affichage. Les réglages système de réduction des animations sont respectés."
        : "Display preferences. System reduced-motion settings are respected."}
    </Diagram>
  );
}
export function VerdictBadge({ value }: { value: string }) {
  return (
    <span className="signal-tag" data-verdict={normalizeVerdict(value)}>
      {value}
    </span>
  );
}

export function ApprovalCountdown({
  expiresAt,
  lang = "fr",
  onExpire,
}: {
  expiresAt: string;
  lang?: SignalLang;
  onExpire?: () => void;
}) {
  const expires = Date.parse(expiresAt);
  const [remaining, setRemaining] = useState<number | null>(null);
  const reported = useRef(false);
  const callback = useRef(onExpire);
  callback.current = onExpire;
  useEffect(() => {
    reported.current = false;
    const tick = () => {
      const value = Number.isFinite(expires)
        ? Math.max(0, Math.ceil((expires - Date.now()) / 1000))
        : null;
      setRemaining(value);
      if (value === 0 && !reported.current) {
        reported.current = true;
        callback.current?.();
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expires]);
  const expired = remaining === 0;
  const text =
    remaining === null
      ? lang === "fr"
        ? "Expiration à vérifier"
        : "Expiry unavailable"
      : expired
        ? "Expiry = deny"
        : `${Math.floor(remaining / 60)
            .toString()
            .padStart(
              2,
              "0",
            )}:${(remaining % 60).toString().padStart(2, "0")} ${lang === "fr" ? "avant expiration" : "until expiry"}`;
  return (
    <span
      className="signal-countdown"
      data-expired={expired}
      role="timer"
      aria-label={text}
    >
      {text}
      <span className="signal-countdown__track" aria-hidden="true" />
    </span>
  );
}
