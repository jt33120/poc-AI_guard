"use client";

import { useId } from "react";
import type { OfferDiagramKind } from "./guard-offers-copy";

export interface OfferDiagramLabels {
  readonly caption: string;
  readonly pc: string;
  readonly assistant: string;
  readonly relay: string;
  readonly provider: string;
  readonly secret: string;
  readonly masked: string;
  readonly others: string;
  readonly hook: string;
  readonly journal: string;
  readonly report: string;
  readonly meta: string;
  readonly rules: string;
  readonly fleet: string;
  readonly labels: Readonly<Record<OfferDiagramKind, string>>;
}

// Two columns: the Claude Code path on the left, what differs per offer on the right.
const LEFT = { x: 14, w: 134, cx: 81 };
const RIGHT = { x: 166, w: 124, cx: 228 };
const ROW = { top: 30, mid: 104, bottom: 196 };

function Box({
  x,
  y,
  w,
  h,
  label,
  tone = "",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tone?: string;
}) {
  return (
    <g>
      <rect
        className={`od-box${tone ? ` od-box--${tone}` : ""}`}
        x={x}
        y={y}
        width={w}
        height={h}
        rx="6"
      />
      <text
        className="od-text"
        x={x + w / 2}
        y={y + h / 2 + 4}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

function Chip({
  x,
  y,
  label,
  tone,
}: {
  x: number;
  y: number;
  label: string;
  tone: "secret" | "safe";
}) {
  return (
    <g>
      <rect
        className={`od-chip od-chip--${tone}`}
        x={x - 44}
        y={y}
        width="88"
        height="18"
        rx="9"
      />
      <text
        className={`od-chip-text od-chip-text--${tone}`}
        x={x}
        y={y + 13}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

/** How one Secret Guard offer works, drawn under its card. */
export function OfferDiagram({
  kind,
  copy,
}: {
  kind: OfferDiagramKind;
  copy: OfferDiagramLabels;
}) {
  const id = useId().replace(/:/g, "");
  const head = (tone: string) => `url(#${id}-${tone})`;
  const pcWidth = kind === "basic" ? 292 : 152;
  return (
    <figure className="offer-diagram">
      <figcaption className="offer-diagram__caption">{copy.caption}</figcaption>
      <svg viewBox="0 0 300 240" role="img" aria-label={copy.labels[kind]}>
        <defs>
          {["plain", "meta", "deny"].map((tone) => (
            <marker
              key={tone}
              id={`${id}-${tone}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path
                className={`od-head od-head--${tone}`}
                d="M0,0 L10,5 L0,10 z"
              />
            </marker>
          ))}
        </defs>
        <rect
          className="od-pc"
          x="4"
          y="8"
          width={pcWidth}
          height="154"
          rx="10"
        />
        <text className="od-pc-label" x="12" y="22">
          {copy.pc}
        </text>

        <Box x={LEFT.x} y={ROW.top} w={LEFT.w} h={32} label={copy.assistant} />
        <line
          className="od-line"
          x1={LEFT.cx}
          y1={62}
          x2={LEFT.cx}
          y2={102}
          markerEnd={head("plain")}
        />
        <Chip x={LEFT.cx} y={73} label={copy.secret} tone="secret" />
        <Box
          x={LEFT.x}
          y={ROW.mid}
          w={LEFT.w}
          h={36}
          label={copy.relay}
          tone="relay"
        />
        <line
          className="od-line"
          x1={LEFT.cx}
          y1={140}
          x2={LEFT.cx}
          y2={194}
          markerEnd={head("plain")}
        />
        <Chip x={LEFT.cx} y={166} label={copy.masked} tone="safe" />
        <Box
          x={LEFT.x}
          y={ROW.bottom}
          w={LEFT.w}
          h={32}
          label={copy.provider}
        />

        {kind === "basic" && (
          <g>
            <Box
              x={RIGHT.x}
              y={ROW.top}
              w={RIGHT.w}
              h={32}
              label={copy.others}
            />
            <line
              className="od-line"
              x1={RIGHT.cx}
              y1={62}
              x2={RIGHT.cx}
              y2={102}
              markerEnd={head("plain")}
            />
            <Box
              x={RIGHT.x}
              y={ROW.mid}
              w={RIGHT.w}
              h={36}
              label={copy.hook}
              tone="deny"
            />
            <line
              className="od-line od-line--deny"
              x1={RIGHT.cx}
              y1={140}
              x2={RIGHT.cx}
              y2={190}
              markerEnd={head("deny")}
            />
            <path
              className="od-cross"
              d={`M${RIGHT.cx - 7} 168 l14 14 M${RIGHT.cx + 7} 168 l-14 14`}
            />
          </g>
        )}

        {kind !== "basic" && (
          <g>
            <path
              className="od-line od-line--meta"
              d={`M${LEFT.x + LEFT.w} 130 H${RIGHT.x - 2}`}
              markerEnd={head("meta")}
            />
            <text
              className="od-small"
              x={RIGHT.cx}
              y={ROW.mid - 8}
              textAnchor="middle"
            >
              {copy.meta}
            </text>
            <Box
              x={RIGHT.x}
              y={ROW.mid}
              w={RIGHT.w}
              h={36}
              label={copy.journal}
              tone="xsom"
            />
            <line
              className="od-line od-line--meta"
              x1={RIGHT.cx}
              y1={140}
              x2={RIGHT.cx}
              y2={194}
              markerEnd={head("meta")}
            />
            <Box
              x={RIGHT.x}
              y={ROW.bottom}
              w={RIGHT.w}
              h={32}
              label={kind === "pro" ? copy.report : copy.fleet}
              tone="xsom"
            />
          </g>
        )}

        {kind === "enterprise" && (
          <g>
            <Box
              x={RIGHT.x}
              y={ROW.top}
              w={RIGHT.w}
              h={32}
              label={copy.rules}
              tone="xsom"
            />
            <path
              className="od-line od-line--meta"
              d={`M${RIGHT.x} 46 H160 V114 H${LEFT.x + LEFT.w + 2}`}
              markerEnd={head("meta")}
            />
          </g>
        )}
      </svg>
      <p className="offer-diagram__text">{copy.labels[kind]}</p>
    </figure>
  );
}
