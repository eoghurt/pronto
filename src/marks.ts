// Marks are stored in PDF space (points, origin bottom-left, before any page
// rotation), so they stay put through zooming, rotating and reordering, and
// the save step can draw them straight into the file.

import type { Tool } from "./recents";

export type Pt = [number, number];
export type Rect = [number, number, number, number]; // x1, y1, x2, y2

interface Base {
  id: string;
  /** Index of the page in the original file. */
  page: number;
  color: string;
}
export interface HighlightMark extends Base { kind: "highlight"; rects: Rect[] }
export interface TextMark extends Base {
  kind: "text";
  /** Top-left corner of the text box. */
  at: Pt;
  /** How far the page was turned (degrees clockwise) when this was typed. */
  rot: number;
  size: number;
  text: string;
}
export interface InkMark extends Base { kind: "ink" | "sign"; width: number; strokes: Pt[][] }
export type Mark = HighlightMark | TextMark | InkMark;

/** A page in the document as it now stands: which original page, and any turn added. */
export interface Slot { src: number; rot: number }

export const colours = {
  tomato: "#FF5A3C",
  ink: "#1E1B2E",
  paper: "#FFF6EC",
  sunflower: "#FFC53D",
  cobalt: "#3D5AFE",
  bubblegum: "#FF8FB8",
  mint: "#2DBE7E",
  lilac: "#C9B6FF",
};

export const toolColour: Record<Tool, string> = {
  highlight: colours.sunflower,
  type: colours.cobalt,
  draw: colours.bubblegum,
  sign: colours.mint,
  pages: colours.lilac,
};

/** Colours each tool offers. The first is the tool's own. */
export const palettes: Record<Tool, string[]> = {
  highlight: [colours.sunflower, colours.bubblegum, colours.mint, colours.lilac],
  type: [colours.cobalt, colours.ink, colours.tomato, colours.mint],
  draw: [colours.bubblegum, colours.cobalt, colours.ink, colours.mint, colours.tomato],
  sign: [colours.ink, colours.cobalt],
  pages: [],
};

/** Typed text: Helvetica on screen and in the file, so what you see is what saves. */
export const TEXT_FONT = `Helvetica, "Helvetica Neue", Arial, sans-serif`;
export const LINE_HEIGHT = 1.25;
/** Baseline of the first line, below the top of the box, in font sizes. */
export const FIRST_BASELINE = (LINE_HEIGHT - 1) / 2 + 0.77;

export const newId = () => Math.random().toString(36).slice(2, 10);

/** A smooth path through the points (midpoint quadratic curves). */
export function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  const f = (n: number) => Math.round(n * 100) / 100;
  if (pts.length < 3) {
    const [a, b = a] = pts;
    return `M${f(a[0])} ${f(a[1])}L${f(b[0]) + 0.01} ${f(b[1])}`;
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${f(last[0])} ${f(last[1])}`;
}

/** Text lines and the PDF-space baseline each starts on. */
export function textBaselines(m: TextMark): { line: string; at: Pt }[] {
  const t = (m.rot * Math.PI) / 180;
  const down: Pt = [Math.sin(t), -Math.cos(t)];
  return m.text.split("\n").map((line, i) => {
    const d = m.size * (FIRST_BASELINE + i * LINE_HEIGHT);
    return { line, at: [m.at[0] + down[0] * d, m.at[1] + down[1] * d] };
  });
}

export function moveMark(m: Mark, dx: number, dy: number) {
  if (m.kind === "highlight") m.rects = m.rects.map(([a, b, c, d]) => [a + dx, b + dy, c + dx, d + dy]);
  else if (m.kind === "text") m.at = [m.at[0] + dx, m.at[1] + dy];
  else m.strokes = m.strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy] as Pt));
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
  const len = vx * vx + vy * vy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

/** Whether a PDF-space point touches a highlight or a stroke (text is hit-tested on screen). */
export function touches(m: Mark, p: Pt, slack: number): boolean {
  if (m.kind === "highlight") {
    return m.rects.some(([x1, y1, x2, y2]) => p[0] >= x1 && p[0] <= x2 && p[1] >= y1 && p[1] <= y2);
  }
  if (m.kind === "text") return false;
  const reach = m.width / 2 + slack;
  return m.strokes.some((s) => s.some((a, i) => segDist(p, a, s[Math.min(i + 1, s.length - 1)]) <= reach));
}
