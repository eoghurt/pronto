// Your signature: drawn once, kept on this Mac, placed with a click after that.

import type { Pt } from "./marks";
import { smoothPath } from "./marks";

export interface Signature {
  w: number;
  h: number;
  strokes: Pt[][]; // pad units, y down, cropped to the ink
}

const KEY = "pronto.signature";

export function loadSignature(): Signature | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s && Array.isArray(s.strokes) && s.strokes.length ? s : null;
  } catch {
    return null;
  }
}

function storeSignature(s: Signature) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* kept for this session only */
  }
}

/** Opens the signing pad. Resolves with the new signature, or null if cancelled. */
export function drawSignature(): Promise<Signature | null> {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="dialog sign-dialog" role="dialog" aria-modal="true">
      <h2>Sign once, use it anywhere</h2>
      <p>Draw your signature with the trackpad or mouse. Pronto keeps it on this Mac only.</p>
      <div class="pad"><svg viewBox="0 0 560 200"><path class="pad-line" d="M28 150H532"/><g class="pad-ink"></g></svg></div>
      <div class="dialog-buttons">
        <button class="btn quiet" data-act="clear">Clear</button>
        <span class="grow"></span>
        <button class="btn plain" data-act="cancel">Cancel</button>
        <button class="btn sign" data-act="use" disabled>Use this signature</button>
      </div></div>`;
    const svg = scrim.querySelector("svg")!;
    const g = scrim.querySelector(".pad-ink")!;
    const use = scrim.querySelector<HTMLButtonElement>('[data-act="use"]')!;
    const strokes: Pt[][] = [];
    let live: Pt[] | null = null;

    const at = (e: PointerEvent): Pt => {
      const r = svg.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 560, ((e.clientY - r.top) / r.height) * 200];
    };
    const paint = () => {
      g.innerHTML = strokes.map((s) => `<path d="${smoothPath(s)}"/>`).join("");
      use.disabled = strokes.length === 0;
    };
    svg.addEventListener("pointerdown", (e) => {
      svg.setPointerCapture(e.pointerId);
      live = [at(e)];
      strokes.push(live);
      paint();
    });
    svg.addEventListener("pointermove", (e) => {
      if (!live) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) live.push(at(ev));
      paint();
    });
    svg.addEventListener("pointerup", () => (live = null));

    const done = (sig: Signature | null) => {
      scrim.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(sig);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") done(null);
    };
    window.addEventListener("keydown", onKey, true);

    scrim.querySelector('[data-act="clear"]')!.addEventListener("click", () => {
      strokes.length = 0;
      paint();
    });
    scrim.querySelector('[data-act="cancel"]')!.addEventListener("click", () => done(null));
    use.addEventListener("click", () => {
      const all = strokes.flat();
      const minX = Math.min(...all.map((p) => p[0]));
      const minY = Math.min(...all.map((p) => p[1]));
      const w = Math.max(...all.map((p) => p[0])) - minX || 1;
      const h = Math.max(...all.map((p) => p[1])) - minY || 1;
      const sig: Signature = { w, h, strokes: strokes.map((s) => s.map(([x, y]) => [x - minX, y - minY] as Pt)) };
      storeSignature(sig);
      done(sig);
    });

    document.body.append(scrim);
  });
}
