import { CLASS_ART_COLORS } from "./Theme";

/**
 * The picture of a class without a logo: a few peers joined to their nearest
 * neighbours, two of them bigger like stations, on a pale ground in a palette
 * hue. Drawn from the class id, so a class looks the same everywhere.
 * Coordinates are for a 200 × 100 viewBox.
 */
export type ClassArt = {
  background: string;
  lines: { x1: number; y1: number; x2: number; y2: number; color: string }[];
  dots: { cx: number; cy: number; r: number; fill: string }[];
};

const W = 200;
const H = 100;
const COLS = 4;
const ROWS = 2;
const MIN_PEERS = 3;
const MARGIN_X = 14;
const MARGIN_Y = 12;

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
  const colors = CLASS_ART_COLORS[Math.abs(hash) % CLASS_ART_COLORS.length][theme];

  // one peer in most cells of a 4 × 2 grid, so they spread over the picture;
  // a cell is only left empty while enough cells remain for three peers.
  // The margins keep the bigger dots inside the picture.
  const nodes: { x: number; y: number }[] = [];
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    const cellsLeft = COLS * ROWS - cell;
    if (nodes.length + cellsLeft > MIN_PEERS && random() < 0.3) continue;
    const col = cell % COLS;
    const row = Math.floor(cell / COLS);
    nodes.push({
      x: MARGIN_X + ((col + 0.15 + 0.7 * random()) * (W - 2 * MARGIN_X)) / COLS,
      y: MARGIN_Y + ((row + 0.15 + 0.7 * random()) * (H - 2 * MARGIN_Y)) / ROWS,
    });
  }

  const art: ClassArt = { background: colors.bg, lines: [], dots: [] };

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
        art.lines.push({ x1: node.x, y1: node.y, x2: nodes[b].x, y2: nodes[b].y, color: colors.line });
      });
  });

  const station = Math.floor(random() * nodes.length);
  nodes.forEach((node, k) => {
    const big = k === station || k === (station + 2) % nodes.length;
    art.dots.push({
      cx: node.x,
      cy: node.y,
      r: big ? 7 : 4.5,
      fill: colors.dots[random() < 0.5 ? 0 : 1],
    });
  });

  cache.set(key, art);
  return art;
}
