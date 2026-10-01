import { clamp, enter, outExpo } from "./kit";

/** A small deterministic generator, so every render draws the same lines. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Point = { x: number; y: number };
const W = 1920;
const H = 1080;

/** Where the leaks start (the code on screen) and the edges of the frame they run to. */
const SOURCE: Point = { x: 860, y: 470 };
const LEAKS = (() => {
  const next = random(7);
  return Array.from({ length: 11 }, (_, index) => {
    const angle = (index / 11) * Math.PI * 2 + next() * 0.4;
    const reach = 1300;
    const end = { x: SOURCE.x + Math.cos(angle) * reach, y: SOURCE.y + Math.sin(angle) * reach * 0.62 };
    const bend = { x: (SOURCE.x + end.x) / 2 + (next() - 0.5) * 260, y: (SOURCE.y + end.y) / 2 + (next() - 0.5) * 200 };
    return { end, bend, delay: next() * 0.9, speed: 0.55 + next() * 0.5 };
  });
})();

const along = (a: Point, c: Point, b: Point, u: number): Point => ({
  x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c.x + u ** 2 * b.x,
  y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c.y + u ** 2 * b.y,
});

/** Red lines running out of the screen to the frame's edges, packets travelling along them. */
export function Leaks({ t, at, out }: { t: number; at: number; out: number }) {
  const fade = clamp((t - at) / 0.3) * (1 - clamp((t - out) / 0.45));
  if (fade <= 0) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: fade, filter: "drop-shadow(0 0 10px rgba(255,66,99,.75))" }}>
      {LEAKS.map(({ end, bend, delay, speed }, index) => {
        const drawn = outExpo(clamp((t - at - delay) / 0.9));
        const path = `M${SOURCE.x},${SOURCE.y} Q${bend.x},${bend.y} ${end.x},${end.y}`;
        return (
          <g key={index}>
            <path d={path} fill="none" stroke="#ff4263" strokeWidth={2.4} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - drawn} opacity={0.85} />
            {[0, 0.33, 0.66].map((phase) => {
              const u = ((t - at - delay) * speed + phase) % 1;
              if (t - at - delay < 0 || u > drawn) return null;
              const p = along(SOURCE, bend, end, u);
              return <circle key={phase} cx={p.x} cy={p.y} r={5} fill="#ffd0d8" />;
            })}
          </g>
        );
      })}
      <circle cx={SOURCE.x} cy={SOURCE.y} r={9 + 5 * Math.sin(t * 9)} fill="#ff4263" opacity={0.9} />
    </svg>
  );
}

/** A jittered triangular lattice over the whole frame. */
const MESH = (() => {
  const next = random(23);
  const cols = 15;
  const rows = 9;
  const nodes: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({
        x: ((c + (r % 2) * 0.5) / (cols - 1)) * W * 1.08 - W * 0.04 + (next() - 0.5) * 70,
        y: (r / (rows - 1)) * H * 1.1 - H * 0.05 + (next() - 0.5) * 60,
      });
    }
  }
  const edges: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) edges.push([i, i + 1]);
      if (r < rows - 1) {
        edges.push([i, i + cols]);
        const diagonal = r % 2 ? c + 1 : c - 1;
        if (diagonal >= 0 && diagonal < cols) edges.push([i, (r + 1) * cols + diagonal]);
      }
    }
  }
  return { nodes, edges, pulse: nodes.map(() => next() * Math.PI * 2) };
})();

/**
 * The blue mesh: a front sweeps left to right from `at`, drawing every edge it passes,
 * then the lattice holds at `level`. Nodes breathe once it has settled.
 */
export function Mesh({ t, at, sweep = 1.6, level = 0.6, out }: { t: number; at: number; sweep?: number; level?: number; out?: number }) {
  if (t < at) return null;
  const fade = out === undefined ? 1 : 1 - clamp((t - out) / 0.4);
  if (fade <= 0) return null;
  const front = -0.15 + 1.35 * outExpo(clamp((t - at) / sweep));
  const shown = (x: number) => clamp((front * W - x) / 260);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: fade, filter: "drop-shadow(0 0 6px rgba(124,192,255,.8))" }}>
      {MESH.edges.map(([a, b], index) => {
        const p = MESH.nodes[a];
        const q = MESH.nodes[b];
        const reveal = shown((p.x + q.x) / 2);
        if (reveal <= 0) return null;
        const flare = clamp(1 - Math.abs(front * W - (p.x + q.x) / 2) / 220);
        return <line key={index} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#7cc0ff" strokeWidth={1.4 + flare * 1.6} opacity={reveal * (level * 0.55 + flare * 0.45)} />;
      })}
      {MESH.nodes.map((node, index) => {
        const reveal = shown(node.x);
        if (reveal <= 0) return null;
        const breath = 0.5 + 0.5 * Math.sin(t * 2.2 + MESH.pulse[index]);
        return <circle key={index} cx={node.x} cy={node.y} r={2.6 + breath * 1.6} fill="#d6ecff" opacity={reveal * (level * 0.7 + 0.3 * breath * enter(t, at + sweep, 0.6))} />;
      })}
    </svg>
  );
}
