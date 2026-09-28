"use client";

// Hand-drawn SVG charts for the supervision room. No chart library: the console
// ships none, and these few forms need exact control over the marks — 2px lines,
// 4px rounded data-ends square at the baseline, a 2px surface gap between stacked
// segments, hairline grids, a crosshair that snaps to the nearest point, a tooltip
// that lists every series, and the same readout on keyboard focus.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  BUCKET_LABEL,
  FAMILIES,
  FAMILY_LABEL,
  families,
  familyDetail,
  formatCount,
  formatMs,
  niceTicks,
  pointRange,
  timeTicks,
  type Family,
  type Lang,
  type LatencyPoint,
  type SeriesPoint,
  type SupervisionWindow,
} from "@/lib/supervision";

const AXIS_W = 48;
const AXIS_H = 28;
const GAP = 2;
const RADIUS = 4;
const MAX_BAR = 24;

export const FAMILY_VAR: Record<Family, string> = {
  allowed: "var(--viz-allowed)",
  notice: "var(--viz-notice)",
  human: "var(--viz-human)",
  none: "var(--viz-none)",
  refused: "var(--viz-refused)",
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A bar whose data-end is rounded and whose baseline stays square. */
function barPath(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return "";
  const r = round ? Math.min(RADIUS, w / 2, h) : 0;
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    r ? `Q${x},${y} ${x + r},${y}` : "",
    `H${x + w - r}`,
    r ? `Q${x + w},${y} ${x + w},${y + r}` : "",
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/** Horizontal twin: rounded at the right (the data-end), square at the left. */
function hbarPath(x: number, y: number, w: number, h: number, round: boolean) {
  if (w <= 0) return "";
  const r = round ? Math.min(RADIUS, h / 2, w) : 0;
  return [
    `M${x},${y}`,
    `H${x + w - r}`,
    r ? `Q${x + w},${y} ${x + w},${y + r}` : "",
    `V${y + h - r}`,
    r ? `Q${x + w},${y + h} ${x + w - r},${y + h}` : "",
    `H${x}`,
    "Z",
  ].join(" ");
}

function Tooltip({
  x,
  width,
  children,
}: {
  x: number;
  width: number;
  children: ReactNode;
}) {
  // Beside the crosshair, never over the mark it describes: to its right on
  // the left half of the chart, to its left on the right half.
  const side = x > width / 2 ? { right: width - x + 14 } : { left: x + 14 };
  return (
    <div className="sup-tooltip" style={side} role="status">
      {children}
    </div>
  );
}

function YAxis({
  ticks,
  scale,
  width,
  format,
}: {
  ticks: number[];
  scale: (value: number) => number;
  width: number;
  format: (value: number) => string;
}) {
  return (
    <g>
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={AXIS_W}
            x2={width}
            y1={scale(tick)}
            y2={scale(tick)}
            className={tick === 0 ? "sup-baseline" : "sup-gridline"}
          />
          <text
            x={AXIS_W - 8}
            y={scale(tick)}
            className="sup-tick"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {format(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function useCrosshair(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (count === 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((current) =>
        Math.min(count - 1, Math.max(0, (current ?? count - 1) + step)),
      );
    }
    if (event.key === "Escape") setActive(null);
  };
  return {
    active,
    setActive,
    onKeyDown,
    onFocus: () => setActive((current) => current ?? count - 1),
    onBlur: () => setActive(null),
  };
}

export function VerdictTimeline({
  points,
  window,
  stepSeconds,
  lang,
  height = 232,
}: {
  points: SeriesPoint[];
  window: SupervisionWindow;
  stepSeconds: number;
  lang: Lang;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const crosshair = useCrosshair(points.length);
  const stacks = points.map((point) => families(point.buckets));
  const totals = stacks.map((stack) =>
    FAMILIES.reduce((sum, family) => sum + stack[family], 0),
  );
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const plotH = height - AXIS_H - 8;
  const scale = (value: number) => 8 + plotH - (value / top) * plotH;
  const band = points.length ? (width - AXIS_W) / points.length : 0;
  const barW = Math.max(2, Math.min(MAX_BAR, band * 0.62));
  const labels = timeTicks(points, window, lang);
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - AXIS_W) / band);
    crosshair.setActive(
      index >= 0 && index < points.length ? index : null,
    );
  };
  const active = crosshair.active;
  return (
    <div
      ref={ref}
      className="sup-chart"
      tabIndex={0}
      aria-label={
        lang === "fr"
          ? "Verdicts dans le temps. Flèches gauche et droite pour parcourir les points."
          : "Verdicts over time. Use left and right arrows to move between points."
      }
      onKeyDown={crosshair.onKeyDown}
      onFocus={crosshair.onFocus}
      onBlur={crosshair.onBlur}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={pick}
          onPointerLeave={() => crosshair.setActive(null)}
          role="img"
          aria-hidden="true"
        >
          <YAxis
            ticks={ticks}
            scale={scale}
            width={width}
            format={(value) => formatCount(value, lang)}
          />
          {active !== null && (
            <rect
              className="sup-crosshair-band"
              x={AXIS_W + active * band}
              y={8}
              width={band}
              height={plotH}
            />
          )}
          {stacks.map((stack, index) => {
            const x = AXIS_W + index * band + (band - barW) / 2;
            let base = 0;
            const drawn = FAMILIES.filter((family) => stack[family] > 0);
            return (
              <g
                key={points[index].at}
                className={active !== null && active !== index ? "sup-dim" : ""}
              >
                {drawn.map((family, order) => {
                  const y0 = scale(base);
                  base += stack[family];
                  const y1 = scale(base);
                  const isTop = order === drawn.length - 1;
                  const gap = order === 0 ? 0 : GAP;
                  return (
                    <path
                      key={family}
                      d={barPath(x, y1, barW, y0 - y1 - gap, isTop)}
                      fill={FAMILY_VAR[family]}
                    />
                  );
                })}
              </g>
            );
          })}
          {[...labels].map(([index, label]) => (
            <text
              key={index}
              x={AXIS_W + index * band + band / 2}
              y={height - 8}
              className="sup-tick"
              textAnchor={index === 0 ? "start" : "middle"}
            >
              {label}
            </text>
          ))}
        </svg>
      )}
      {active !== null && (
        <Tooltip x={AXIS_W + active * band + band / 2} width={width}>
          <p className="sup-tooltip-head">
            {pointRange(points[active].at, stepSeconds, window, lang)}
          </p>
          <p className="sup-tooltip-total">
            <strong>{formatCount(totals[active], lang)}</strong>{" "}
            {lang === "fr" ? "événements" : "events"}
          </p>
          <ul>
            {[...FAMILIES].reverse().map((family) => (
              <li key={family}>
                <span
                  className="sup-key-line"
                  style={{ background: FAMILY_VAR[family] }}
                />
                <strong>{formatCount(stacks[active][family], lang)}</strong>
                <span>
                  {FAMILY_LABEL[family][lang]}
                  {family === "none" || family === "human"
                    ? familyDetail(points[active].buckets, family)
                        .map(
                          ([name, count]) =>
                            ` · ${formatCount(count, lang)} ${BUCKET_LABEL[name][lang]}`,
                        )
                        .join("")
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </Tooltip>
      )}
    </div>
  );
}

export function LatencyChart({
  points,
  window,
  stepSeconds,
  lang,
  height = 200,
}: {
  points: LatencyPoint[];
  window: SupervisionWindow;
  stepSeconds: number;
  lang: Lang;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const crosshair = useCrosshair(points.length);
  const values = points.flatMap((point) =>
    [point.p50, point.p95].filter((value): value is number => value !== null),
  );
  const ticks = niceTicks(Math.max(...values, 0));
  const top = ticks[ticks.length - 1] || 1;
  const plotH = height - AXIS_H - 12;
  const scale = (value: number) => 12 + plotH - (value / top) * plotH;
  const band = points.length ? (width - AXIS_W - 28) / points.length : 0;
  const cx = (index: number) => AXIS_W + index * band + band / 2;
  const labels = timeTicks(points, window, lang);
  const series: { key: "p50" | "p95"; color: string }[] = [
    { key: "p50", color: "var(--viz-p50)" },
    { key: "p95", color: "var(--viz-p95)" },
  ];
  const path = (key: "p50" | "p95") => {
    let d = "";
    let pen = false;
    points.forEach((point, index) => {
      const value = point[key];
      if (value === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${cx(index)},${scale(value)} `;
      pen = true;
    });
    return d.trim();
  };
  const last = (key: "p50" | "p95") => {
    for (let index = points.length - 1; index >= 0; index -= 1) {
      const value = points[index][key];
      if (value !== null) return { index, value };
    }
    return null;
  };
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - AXIS_W) / band);
    crosshair.setActive(
      index >= 0 && index < points.length ? index : null,
    );
  };
  const active = crosshair.active;
  const ends = series.map((line) => ({ ...line, end: last(line.key) }));
  const labelY = new Map<string, number>();
  ends.forEach((line) => {
    if (line.end) labelY.set(line.key, scale(line.end.value));
  });
  const p50Y = labelY.get("p50");
  const p95Y = labelY.get("p95");
  if (p50Y !== undefined && p95Y !== undefined && p50Y - p95Y < 14) {
    labelY.set("p95", p50Y - 14);
  }
  return (
    <div
      ref={ref}
      className="sup-chart"
      tabIndex={0}
      aria-label={
        lang === "fr"
          ? "Latence de la garde, médiane et 95e centile, en millisecondes."
          : "Guard latency, median and 95th percentile, in milliseconds."
      }
      onKeyDown={crosshair.onKeyDown}
      onFocus={crosshair.onFocus}
      onBlur={crosshair.onBlur}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onPointerMove={pick}
          onPointerLeave={() => crosshair.setActive(null)}
          aria-hidden="true"
        >
          <YAxis
            ticks={ticks}
            scale={scale}
            width={width - 28}
            format={(value) => formatCount(value, lang)}
          />
          {active !== null && (
            <line
              className="sup-crosshair"
              x1={cx(active)}
              x2={cx(active)}
              y1={12}
              y2={12 + plotH}
            />
          )}
          {series.map((line) => (
            <path
              key={line.key}
              d={path(line.key)}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {ends.map((line) =>
            line.end ? (
              <g key={line.key}>
                <circle
                  cx={cx(line.end.index)}
                  cy={scale(line.end.value)}
                  r={4}
                  fill={line.color}
                  className="sup-dot"
                />
                <text
                  x={cx(line.end.index) + 9}
                  y={labelY.get(line.key)}
                  className="sup-end-label"
                  dominantBaseline="middle"
                >
                  {line.key}
                </text>
              </g>
            ) : null,
          )}
          {active !== null &&
            series.map((line) => {
              const value = points[active][line.key];
              return value === null ? null : (
                <circle
                  key={line.key}
                  cx={cx(active)}
                  cy={scale(value)}
                  r={4}
                  fill={line.color}
                  className="sup-dot"
                />
              );
            })}
          {[...labels].map(([index, label]) => (
            <text
              key={index}
              x={cx(index)}
              y={height - 8}
              className="sup-tick"
              textAnchor={index === 0 ? "start" : "middle"}
            >
              {label}
            </text>
          ))}
        </svg>
      )}
      {active !== null && (
        <Tooltip x={cx(active)} width={width}>
          <p className="sup-tooltip-head">
            {pointRange(points[active].at, stepSeconds, window, lang)}
          </p>
          {points[active].samples === 0 ? (
            <p className="sup-tooltip-total">
              {lang === "fr" ? "Aucune mesure" : "No measurement"}
            </p>
          ) : (
            <ul>
              {[...series].reverse().map((line) => (
                <li key={line.key}>
                  <span
                    className="sup-key-line"
                    style={{ background: line.color }}
                  />
                  <strong>{formatMs(points[active][line.key], lang)}</strong>
                  <span>{line.key}</span>
                </li>
              ))}
              <li className="sup-tooltip-note">
                {formatCount(points[active].samples, lang)}{" "}
                {lang === "fr" ? "décisions mesurées" : "decisions measured"}
              </li>
            </ul>
          )}
        </Tooltip>
      )}
    </div>
  );
}

export interface Column {
  label: string;
  value: number;
  accent?: "warning";
  note?: string;
}

/** One measure per column: one colour, the value on the cap. */
export function ColumnChart({
  columns,
  lang,
  height = 180,
  ariaLabel,
}: {
  columns: Column[];
  lang: Lang;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const top = Math.max(1, ...columns.map((column) => column.value));
  const plotH = height - AXIS_H - 22;
  const band = columns.length ? width / columns.length : 0;
  const barW = Math.max(4, Math.min(MAX_BAR * 1.5, band * 0.56));
  return (
    <div ref={ref} className="sup-chart" aria-label={ariaLabel} role="figure">
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          <line
            x1={0}
            x2={width}
            y1={22 + plotH}
            y2={22 + plotH}
            className="sup-baseline"
          />
          {columns.map((column, index) => {
            const h = (column.value / top) * plotH;
            const x = index * band + (band - barW) / 2;
            const y = 22 + plotH - h;
            return (
              <g
                key={column.label}
                className={active !== null && active !== index ? "sup-dim" : ""}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
              >
                <rect
                  x={index * band}
                  y={0}
                  width={band}
                  height={height}
                  fill="transparent"
                />
                <path
                  d={barPath(x, y, barW, Math.max(h, column.value ? 2 : 0), true)}
                  fill={
                    column.accent === "warning"
                      ? "var(--viz-warning)"
                      : "var(--viz-p50)"
                  }
                />
                <text
                  x={x + barW / 2}
                  y={y - 6}
                  className="sup-cap"
                  textAnchor="middle"
                >
                  {formatCount(column.value, lang)}
                </text>
                <text
                  x={index * band + band / 2}
                  y={height - 8}
                  className="sup-tick"
                  textAnchor="middle"
                >
                  {column.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export interface StackBar {
  key: string;
  label: string;
  segments: { family: Family; value: number }[];
  total: number;
  suffix?: string;
}

/** Horizontal stacked bars on one shared scale, the total at the tip. */
export function StackedRows({
  bars,
  lang,
  labelWidth = 128,
  mono = false,
}: {
  bars: StackBar[];
  lang: Lang;
  labelWidth?: number;
  mono?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ bar: number; family: Family } | null>(
    null,
  );
  const tipRoom = 76;
  const plotW = Math.max(0, width - labelWidth - tipRoom);
  const max = Math.max(1, ...bars.map((bar) => bar.total));
  const bandH = 30;
  const barH = 12;
  const height = bars.length * bandH + 4;
  return (
    <div ref={ref} className="sup-chart">
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          {bars.map((bar, barIndex) => {
            const y = barIndex * bandH + (bandH - barH) / 2;
            let cursor = labelWidth;
            const drawn = bar.segments.filter((segment) => segment.value > 0);
            const end =
              labelWidth +
              drawn.reduce((sum, segment) => sum + (segment.value / max) * plotW, 0);
            return (
              <g key={bar.key}>
                <text
                  x={0}
                  y={y + barH / 2}
                  className={mono ? "sup-bar-label sup-mono" : "sup-bar-label"}
                  dominantBaseline="middle"
                >
                  {bar.label.length > 18 ? `${bar.label.slice(0, 17)}…` : bar.label}
                </text>
                <rect
                  x={labelWidth}
                  y={y}
                  width={plotW}
                  height={barH}
                  className="sup-track"
                  rx={2}
                />
                {drawn.map((segment, index) => {
                  const w = (segment.value / max) * plotW;
                  const x = cursor + (index === 0 ? 0 : GAP);
                  cursor += w;
                  return (
                    <path
                      key={segment.family}
                      d={hbarPath(
                        x,
                        y,
                        Math.max(1, w - (index === 0 ? 0 : GAP)),
                        barH,
                        index === drawn.length - 1,
                      )}
                      fill={FAMILY_VAR[segment.family]}
                      className={
                        hover &&
                        (hover.bar !== barIndex || hover.family !== segment.family)
                          ? "sup-dim"
                          : ""
                      }
                      onPointerEnter={() =>
                        setHover({ bar: barIndex, family: segment.family })
                      }
                      onPointerLeave={() => setHover(null)}
                    >
                      <title>
                        {`${FAMILY_LABEL[segment.family][lang]} · ${formatCount(segment.value, lang)}`}
                      </title>
                    </path>
                  );
                })}
                <text
                  x={end + 8}
                  y={y + barH / 2}
                  className="sup-cap"
                  dominantBaseline="middle"
                >
                  {formatCount(bar.total, lang)}
                  {bar.suffix ? ` ${bar.suffix}` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function Sparkline({
  values,
  color,
  width = 96,
  height = 28,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = (width - 6) / (values.length - 1);
  const y = (value: number) => 3 + (height - 6) - (value / max) * (height - 6);
  const d = values
    .map((value, index) => `${index ? "L" : "M"}${3 + index * step},${y(value)}`)
    .join(" ");
  const lastIndex = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden="true" className="sup-spark">
      <path
        d={d}
        fill="none"
        stroke="var(--viz-muted)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={3 + lastIndex * step}
        cy={y(values[lastIndex])}
        r={3}
        fill={color}
        className="sup-dot"
      />
    </svg>
  );
}

export function Legend({
  items,
  lang,
}: {
  items: { key: string; label: string; color: string; value?: number }[];
  lang: Lang;
}) {
  return (
    <ul className="sup-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className="sup-key-box" style={{ background: item.color }} />
          <span>{item.label}</span>
          {item.value !== undefined && (
            <strong>{formatCount(item.value, lang)}</strong>
          )}
        </li>
      ))}
    </ul>
  );
}
