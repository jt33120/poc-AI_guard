import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp, enter, useTime } from "./kit";

export const SIGNAL_SECONDS = 7;
export type Variant = "guarded" | "unguarded";

/** The design system's light tokens (frontend/design-system/tokens.css). */
const C = {
  bg: "#f4f7fb", surface: "#ffffff", text: "#12253e", faint: "#51657b", line: "#cad7e7", strong: "#6c839f",
  accent: "#195dad", wash: "#dfebfb", hitl: "#755014", deny: "#943535", allow: "#225746",
};
const MONO: CSSProperties = { fontFamily: "Mono, monospace", letterSpacing: "0.08em" };

type Node = { x: number; title: string; detail: string; tone: string; dashed?: boolean; dim?: number; glow?: number };

function Box({ node, y, appear }: { node: Node; y: number; appear: number }) {
  return (
    <div
      style={{
        position: "absolute", left: node.x, top: y, width: 230, height: 104, borderRadius: 12,
        border: `${node.glow ? 2 : 1.5}px ${node.dashed ? "dashed" : "solid"} ${node.tone}`,
        background: C.surface, opacity: appear * (1 - (node.dim ?? 0) * 0.55),
        transform: `translateY(${(1 - appear) * 14}px)`,
        boxShadow: node.glow ? `0 0 0 ${6 * node.glow}px ${node.tone}22, 0 10px 28px #17355418` : "0 8px 24px #17355414",
        display: "grid", placeContent: "center", textAlign: "center", gap: 8,
      }}
    >
      <div style={{ fontFamily: "Manrope, Source, sans-serif", fontWeight: 650, fontSize: 25, color: node.tone }}>{node.title}</div>
      <div style={{ ...MONO, fontSize: 14, color: C.faint, letterSpacing: "0.02em" }}>{node.detail}</div>
    </div>
  );
}

function Chip({ label, on, tone }: { label: string; on: number; tone: string }) {
  return (
    <div
      style={{
        ...MONO, fontSize: 15, padding: "10px 16px", borderRadius: 9,
        border: `1.5px solid ${on > 0.5 ? tone : "transparent"}`,
        background: on > 0.5 ? `${tone}14` : "transparent", color: on > 0.5 ? tone : C.text,
      }}
    >
      {label}
    </div>
  );
}

function Fade({ t, at, children, style }: { t: number; at: number; children: ReactNode; style?: CSSProperties }) {
  const shown = enter(t, at, 0.5);
  return <div style={{ ...style, opacity: shown, transform: `translateY(${(1 - shown) * 8}px)` }}>{children}</div>;
}

const ROW = 290;
const XS = [72, 362, 652, 942];
const mid = (index: number) => ({ x: XS[index] + 115, y: ROW + 52 });

/**
 * Agent → Guard → Policy → Tool, as the shared diagram tells it. Guarded: the call waits for a
 * human, the approval expires, the policy denies and the tool never runs. Unguarded: the call
 * goes round the gate and runs. Illustrative events only.
 */
export function SignalSequence({ variant }: { variant: Variant }) {
  const t = useTime();
  const guarded = variant === "guarded";
  const appear = (index: number) => enter(t, 0.1 + index * 0.12, 0.5);

  // The approval clock runs from 2.2 s to 4.4 s; then the policy denies.
  const waiting = clamp((t - 2.2) / 2.2);
  const denied = guarded && t >= 4.4;
  const verdict = !guarded ? "" : denied ? "DENY" : t >= 2.05 ? "HITL" : t >= 1.8 ? "NOTIFY" : t >= 1.55 ? "AUTO" : "";
  const executed = !guarded && t >= 1.95;

  const nodes: Node[] = [
    { x: XS[0], title: "Agent", detail: "tool.call → MCP", tone: C.text },
    guarded
      ? { x: XS[1], title: "Guard", detail: "policy.match", tone: t >= 1.3 ? C.accent : C.strong, glow: t >= 1.3 ? 1 : 0 }
      : { x: XS[1], title: "Guard", detail: "no gate", tone: C.strong, dashed: true, dim: 1 },
    guarded
      ? {
          x: XS[2], title: denied ? "DENY" : verdict === "HITL" ? "HITL" : "Policy",
          detail: denied ? "on_expiry: deny" : verdict === "HITL" ? "human_approval" : "evaluate",
          tone: denied ? C.deny : verdict === "HITL" ? C.hitl : C.strong, glow: verdict === "HITL" || denied ? 1 : 0,
        }
      : { x: XS[2], title: "Policy", detail: "none", tone: C.strong, dashed: true, dim: 1 },
    guarded
      ? { x: XS[3], title: "Tool", detail: t >= 4.8 ? "not executed" : "pending", tone: t >= 4.8 ? C.strong : C.text, dashed: t >= 4.8 }
      : { x: XS[3], title: "Tool", detail: executed ? "executed" : "pending", tone: executed ? C.deny : C.text, glow: executed ? 1 : 0 },
  ];

  // The packet: through every box when guarded (stopping at the policy), over them when not.
  const packet = (() => {
    if (guarded) {
      const leg = (from: number, to: number, start: number, span: number) => {
        const u = clamp((t - start) / span);
        const a = mid(from);
        const b = mid(to);
        return { x: a.x + (b.x - a.x) * u, y: a.y, on: t >= start };
      };
      if (t < 1.3) return leg(0, 1, 0.7, 0.6);
      return leg(1, 2, 1.3, 0.4);
    }
    const u = clamp((t - 0.7) / 1.25);
    const a = mid(0);
    const b = mid(3);
    return { x: a.x + (b.x - a.x) * u, y: a.y - Math.sin(Math.PI * u) * 150, on: t >= 0.7 && u < 1 };
  })();
  const packetFade = guarded ? 1 - clamp((t - 4.4) / 0.3) : 1;

  return (
    <AbsoluteFill style={{ background: C.bg, color: C.text, fontFamily: "Source, sans-serif" }}>
      <div style={{ position: "absolute", left: 48, top: 30, display: "flex", alignItems: "center", gap: 16 }}>
        <Img src={staticFile("brand/mark.svg")} style={{ width: 46, height: 46 }} />
        <div style={{ fontFamily: "Manrope, sans-serif", fontWeight: 700, fontSize: 27 }}>xSOM AI Guard</div>
      </div>
      <div style={{ ...MONO, position: "absolute", right: 48, top: 46, fontSize: 14, color: C.faint }}>
        ILLUSTRATIVE SEQUENCE / {variant.toUpperCase()}
      </div>

      <div style={{ position: "absolute", left: 40, right: 40, top: 104, height: 520, borderRadius: 18, background: C.surface, border: `1px solid ${C.line}`, boxShadow: "0 8px 24px #17355414" }}>
        <div style={{ ...MONO, position: "absolute", left: 32, top: 26, fontSize: 14, color: C.faint }}>AGENT → GUARD → POLICY → TOOL</div>
        <div style={{ position: "absolute", right: 28, top: 14, display: "flex", gap: 6 }}>
          <Chip label="AUTO" on={verdict === "AUTO" ? 1 : 0} tone={C.allow} />
          <Chip label="NOTIFY" on={verdict === "NOTIFY" ? 1 : 0} tone={C.accent} />
          <Chip label="HITL" on={verdict === "HITL" ? 1 : 0} tone={C.hitl} />
          <Chip label="DENY" on={verdict === "DENY" ? 1 : 0} tone={C.deny} />
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 70, borderTop: `1px solid ${C.line}` }} />
        <div style={{ position: "absolute", left: 0, right: 0, top: 410, borderTop: `1px solid ${C.line}` }} />
      </div>

      <svg viewBox="0 0 1280 720" style={{ position: "absolute", inset: 0 }}>
        {[0, 1, 2].map((index) => {
          const from = XS[index] + 230;
          const to = XS[index + 1];
          const blocked = guarded && index === 2 && t >= 4.8;
          return (
            <g key={index} opacity={appear(index + 1) * (!guarded && index > 0 && index < 3 ? 0.35 : 1)}>
              <line x1={from} y1={ROW + 52} x2={to - 6} y2={ROW + 52} stroke={blocked ? C.deny : C.strong} strokeWidth={1.5} strokeDasharray={blocked ? "5 5" : undefined} />
              <path d={`M${to - 10},${ROW + 46} L${to},${ROW + 52} L${to - 10},${ROW + 58} Z`} fill={blocked ? C.deny : C.strong} />
              {blocked && (
                <g stroke={C.deny} strokeWidth={3} strokeLinecap="round" opacity={enter(t, 4.8, 0.3)}>
                  <line x1={(from + to) / 2 - 9} y1={ROW + 43} x2={(from + to) / 2 + 9} y2={ROW + 61} />
                  <line x1={(from + to) / 2 + 9} y1={ROW + 43} x2={(from + to) / 2 - 9} y2={ROW + 61} />
                </g>
              )}
            </g>
          );
        })}
        {!guarded && (
          <path
            d={`M${mid(0).x},${ROW} Q${(mid(0).x + mid(3).x) / 2},${ROW - 300} ${mid(3).x},${ROW}`}
            fill="none" stroke={C.deny} strokeWidth={2} strokeDasharray="7 6" pathLength={1}
            opacity={0.8 * enter(t, 0.5, 0.4)}
          />
        )}
        {guarded && t >= 2.2 && !denied && (
          <g transform={`translate(${mid(2).x + 98}, ${ROW - 2})`}>
            <circle r={17} fill={C.surface} stroke={C.line} strokeWidth={3} />
            <circle r={17} fill="none" stroke={C.hitl} strokeWidth={3} pathLength={1} strokeDasharray={1} strokeDashoffset={waiting} transform="rotate(-90)" />
          </g>
        )}
        {packet.on && <circle cx={packet.x} cy={packet.y} r={9} fill={guarded ? C.accent : C.deny} opacity={packetFade} />}
      </svg>

      {nodes.map((node, index) => (
        <Box key={node.title + index} node={node} y={ROW} appear={appear(index)} />
      ))}

      <div style={{ position: "absolute", left: 72, right: 72, top: 538, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 21 }}>
        {guarded ? (
          <>
            <div style={{ position: "relative", height: 30, flex: 1 }}>
              {t >= 2.2 && t < 4.4 && <Fade t={t} at={2.2} style={{ position: "absolute" }}>Waiting for a human approval · {Math.ceil(30 * (1 - waiting))} s</Fade>}
              {t >= 4.4 && <Fade t={t} at={4.6} style={{ position: "absolute", color: C.deny, fontWeight: 600 }}>Approval expired: blocked before any side effect.</Fade>}
            </div>
            <Fade t={t} at={5.2} style={{ ...MONO, fontSize: 14, color: C.accent, padding: "9px 14px", borderRadius: 9, background: C.wash, letterSpacing: "0.02em" }}>
              audit_log #4821 · sha256 9f3c…e1a7
            </Fade>
          </>
        ) : (
          <>
            <div style={{ position: "relative", height: 30, flex: 1 }}>
              {executed && <Fade t={t} at={2.05} style={{ position: "absolute", color: C.deny, fontWeight: 600 }}>Executed with no gate and no approval.</Fade>}
            </div>
            <Fade t={t} at={2.7} style={{ ...MONO, fontSize: 14, color: C.deny, padding: "9px 14px", borderRadius: 9, background: `${C.deny}12`, letterSpacing: "0.02em" }}>
              audit_log · no record
            </Fade>
          </>
        )}
      </div>

      <div style={{ ...MONO, position: "absolute", left: 48, bottom: 30, fontSize: 14, color: C.faint, letterSpacing: "0.14em" }}>
        CONTROL THE ACTION. KEEP THE EVIDENCE.
      </div>
    </AbsoluteFill>
  );
}
