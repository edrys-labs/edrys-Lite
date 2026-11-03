import { ROOM_COLORS } from "./Theme";

/**
 * The picture of a class without a logo: peers joined to their nearest
 * neighbours, two of them bigger like stations, in a room colour. Drawn from
 * the class id, so a class looks the same everywhere. Coordinates are for a
 * 200 × 100 viewBox.
 */
export type ClassArt = {
  background: string;
  lines: { x1: number; y1: number; x2: number; y2: number; color: string }[];
  dots: { cx: number; cy: number; r: number; fill: string; ring: number }[];
};

const W = 200;
const H = 100;
const COLS = 5;
const ROWS = 3;

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashCode(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

const cache = new Map<string, ClassArt>();

export function classArt(id: string, theme: "light" | "dark"): ClassArt {
  const key = `${theme}:${id || ""}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const hash = hashCode(id || "");
  const random = mulberry32(hash);
  const colors = ROOM_COLORS[Math.abs(hash) % ROOM_COLORS.length];
  const tone = colors[theme];
  const dark = theme === "dark";

  // one peer in most cells of a 5 × 3 grid, so they spread over the picture
  const nodes: { x: number; y: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (random() < 0.3) continue;
      nodes.push({
        x: ((col + 0.2 + 0.6 * random()) * W) / COLS,
        y: ((row + 0.2 + 0.6 * random()) * H) / ROWS,
      });
    }
  }

  const art: ClassArt = { background: tone.bg, lines: [], dots: [] };

  const joined = new Set<string>();
  nodes.forEach((node, a) => {
    nodes
      .map((other, b) => ({ b, dist: Math.hypot(other.x - node.x, other.y - node.y) }))
      .filter(({ b }) => b !== a)
      .sort((p, q) => p.dist - q.dist)
      .slice(0, 2)
      .forEach(({ b }) => {
        const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (joined.has(pair)) return;
        joined.add(pair);
        art.lines.push({
          x1: node.x,
          y1: node.y,
          x2: nodes[b].x,
          y2: nodes[b].y,
          color: dark ? colors.dot : colors.border,
        });
      });
  });

  const station = Math.floor(random() * nodes.length);
  nodes.forEach((node, k) => {
    const big = k === station || k === (station + 3) % nodes.length;
    art.dots.push({
      cx: node.x,
      cy: node.y,
      r: big ? 6 : 3.2,
      fill: big ? tone.fg : dark ? colors.border : colors.dot,
      ring: big ? 2.5 : 1.5,
    });
  });

  cache.set(key, art);
  return art;
}
