// The document view: pages, the five tools, thumbnails, undo and saving.

// The legacy build fills in JavaScript that Safari's engine (which Tauri uses on
// macOS) doesn't have yet, such as Map.getOrInsertComputed. The modern build
// draws nothing there.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { icons } from "./icons";
import {
  LINE_HEIGHT, TEXT_FONT, moveMark, newId, palettes, smoothPath, toolColour, touches,
  type InkMark, type Mark, type Pt, type Rect, type Slot, type TextMark,
} from "./marks";
import { basename, isScratch, note, pickSavePath, report, writePdf } from "./native";
import { touchRecent, type Tool } from "./recents";
import { drawSignature, loadSignature } from "./signature";
import { askText, toast } from "./ui";

// Start the worker as the app loads, so the first file doesn't wait for it.
pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });

type Viewport = ReturnType<PDFPageProxy["getViewport"]>;

interface View {
  slot: Slot;
  /** The turn this view was drawn with; slots change in place, so it's kept apart. */
  rot: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  textLayer: HTMLDivElement;
  hl: SVGSVGElement;
  ink: SVGSVGElement;
  texts: HTMLDivElement;
  /** The page at scale 1, turned as shown. Null until the page has loaded. */
  vp: Viewport | null;
  rendered: number;
  task: RenderTask | null;
  textDone: boolean;
  near: boolean;
  thumb: HTMLDivElement;
  thumbSvg: SVGSVGElement;
  thumbDone: boolean;
}

interface Snapshot {
  marks: Mark[];
  slots: Slot[];
  version: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SVG_NS = "http://www.w3.org/2000/svg";

const scroller = $("scroller");
const pagesEl = $("pages");
const thumbsEl = $("thumbs");
const onPageEl = $("onpage");
const toolbar = $("toolbar");
const swatches = $("swatches");

// ---- Document state ----

let pdf: PDFDocumentProxy | null = null;
let original: Uint8Array = new Uint8Array();
let loading: ReturnType<typeof pdfjs.getDocument> | null = null;
let filePath = "";
let fileName = "";
let marks: Mark[] = [];
let slots: Slot[] = [];
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
let version = 0;
let savedVersion = 0;
let nextVersion = 1;
let proxies: (Promise<PDFPageProxy> | undefined)[] = [];
let views: View[] = [];
let scale = 1;
let current = 0;
let selected: string | null = null;
let lastStroke: { id: string; at: number } | null = null;
let saving = false;

// ---- Tool state, remembered between launches ----

let tool: Tool = "highlight";
const prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem("pronto.prefs") || "{}");
  } catch {
    return {};
  }
})() as { colours?: Partial<Record<Tool, string>>; textSize?: number; thick?: boolean };
const colourFor = (t: Tool) => prefs.colours?.[t] ?? palettes[t][0] ?? toolColour[t];
const savePrefs = () => {
  try {
    localStorage.setItem("pronto.prefs", JSON.stringify(prefs));
  } catch {
    /* fine without */
  }
};
const textSize = () => prefs.textSize ?? 13;
let stamp: string | null = null;

export const isOpen = () => pdf !== null;
export const isDirty = () => pdf !== null && version !== savedVersion;
export const openPath = () => filePath;

// ---- Opening ----

let openedAt = 0;
let firstDrawn = false;

export async function open(path: string, bytes: Uint8Array) {
  await close();
  openedAt = performance.now();
  firstDrawn = false;
  filePath = path;
  fileName = basename(path);
  original = bytes;
  $("doc-title").textContent = fileName;
  document.title = fileName;

  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of what it's given; keep the original for saving
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    enableXfa: false,
  });
  task.onPassword = async (update: (pw: string) => void, reason: number) => {
    const pw = await askText(
      reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD ? "That password didn't work" : "This PDF has a password",
      `Enter the password for ${fileName}.`,
      true,
    );
    if (pw === null) task.destroy();
    else update(pw);
  };
  loading = task;
  pdf = await task.promise;

  slots = Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rot: 0 }));
  proxies = new Array(pdf.numPages);
  marks = [];
  undoStack = [];
  redoStack = [];
  version = savedVersion = 0;
  current = 0;
  selected = null;

  // Size everything from page 1, fitted to the window, and draw it straight away.
  const first = await proxy(0);
  scale = fitScale(first.getViewport({ scale: 1 }).width);
  applyScale();
  buildViews();
  scroller.scrollTop = 0;
  scroller.scrollLeft = 0;
  scheduleRender();
  chrome();
  setTool(tool);
  // Then learn every page's real size in the background.
  loadAllSizes();
}

export async function close() {
  commitEditing();
  for (const v of views) v.task?.cancel();
  views = [];
  pagesEl.replaceChildren();
  thumbsEl.replaceChildren();
  const old = loading;
  pdf = null;
  loading = null;
  proxies = [];
  if (old) await old.destroy();
}

function proxy(src: number): Promise<PDFPageProxy> {
  return (proxies[src] ??= pdf!.getPage(src + 1));
}

async function loadAllSizes() {
  const doc = pdf;
  for (const v of [...views]) {
    if (pdf !== doc) return;
    if (!v.vp) {
      await setViewport(v);
      drawMarks(v);
    }
  }
}

async function setViewport(v: View) {
  const page = await proxy(v.slot.src);
  v.vp = page.getViewport({ scale: 1, rotation: (page.rotate + v.slot.rot) % 360 });
  v.el.style.setProperty("--w", String(v.vp.width));
  v.el.style.setProperty("--h", String(v.vp.height));
  const tp = v.thumb.querySelector<HTMLElement>(".tpage")!;
  tp.style.aspectRatio = `${v.vp.width} / ${v.vp.height}`;
  v.thumbSvg.setAttribute("viewBox", `0 0 ${v.vp.width} ${v.vp.height}`);
  for (const svg of [v.hl, v.ink]) svg.setAttribute("viewBox", `0 0 ${v.vp.width} ${v.vp.height}`);
}

function fitScale(pageWidth: number) {
  // Leave the side padding, plus room for a scrollbar that may not be showing yet.
  const room = scroller.clientWidth - 150;
  return Math.max(0.4, Math.min(1.6, room / pageWidth));
}

// ---- Building pages and thumbnails ----

const observeNear = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const v = views.find((x) => x.el === e.target);
      if (v) v.near = e.isIntersecting;
    }
    scheduleRender();
  },
  { root: scroller, rootMargin: "120% 60%" },
);

// Pages far off screen give back their canvas memory.
const observeFar = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const v = views.find((x) => x.el === e.target);
      if (!v || e.isIntersecting) continue;
      v.task?.cancel();
      v.canvas?.remove();
      v.canvas = null;
      v.rendered = 0;
    }
  },
  { root: scroller, rootMargin: "500% 200%" },
);

const observeThumbs = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const v = views.find((x) => x.thumb === e.target);
      if (v && !v.thumbDone) renderThumb(v);
    }
  },
  { root: thumbsEl, rootMargin: "200% 0px" },
);

function makeView(slot: Slot, estimate: { w: number; h: number }): View {
  const el = document.createElement("div");
  el.className = "page";
  el.style.setProperty("--w", String(estimate.w));
  el.style.setProperty("--h", String(estimate.h));
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const hl = document.createElementNS(SVG_NS, "svg");
  hl.classList.add("layer", "hl-layer");
  hl.setAttribute("preserveAspectRatio", "none");
  const ink = document.createElementNS(SVG_NS, "svg");
  ink.classList.add("layer", "ink-layer");
  ink.setAttribute("preserveAspectRatio", "none");
  const texts = document.createElement("div");
  texts.className = "texts";
  el.append(hl, textLayer, ink, texts);

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.innerHTML = `<div class="tpage"><svg class="tmarks" preserveAspectRatio="none"></svg>
      <div class="tactions"><button data-act="rotate" title="Turn page">${icons.rotate}</button><button data-act="delete" title="Delete page">${icons.trash}</button></div>
    </div><span class="tnum"></span>`;
  thumb.querySelector<HTMLElement>(".tpage")!.style.aspectRatio = `${estimate.w} / ${estimate.h}`;

  return {
    slot, rot: slot.rot, el, canvas: null, textLayer, hl, ink, texts, vp: null, rendered: 0, task: null,
    textDone: false, near: false, thumb, thumbSvg: thumb.querySelector("svg")!, thumbDone: false,
  };
}

/** Lays out pages for the current slots, reusing any page that hasn't changed. */
function buildViews() {
  const old = views;
  const est = old.find((v) => v.vp)?.vp ?? null;
  const estimate = est ? { w: est.width, h: est.height } : { w: 612, h: 792 };
  views = slots.map((slot) => {
    const i = old.findIndex((v) => v.slot.src === slot.src && v.rot === slot.rot);
    if (i >= 0) {
      const [v] = old.splice(i, 1);
      v.slot = slot;
      return v;
    }
    return makeView(slot, estimate);
  });
  for (const v of old) {
    v.task?.cancel();
    observeNear.unobserve(v.el);
    observeFar.unobserve(v.el);
    observeThumbs.unobserve(v.thumb);
  }
  pagesEl.replaceChildren(...views.map((v) => v.el));
  thumbsEl.replaceChildren(...views.map((v) => v.thumb));
  views.forEach((v, i) => {
    v.thumb.querySelector(".tnum")!.textContent = String(i + 1);
    observeNear.observe(v.el);
    observeFar.observe(v.el);
    observeThumbs.observe(v.thumb);
    if (v.vp) drawMarks(v);
    else setViewport(v).then(() => drawMarks(v));
  });
  current = Math.min(current, views.length - 1);
  trackCurrent();
}

// ---- Rendering ----

let renderLoop = false;

function scheduleRender() {
  if (renderLoop) return;
  renderLoop = true;
  requestAnimationFrame(async () => {
    try {
      for (let v = nextToRender(); v; v = nextToRender()) await renderPage(v);
    } finally {
      renderLoop = false;
    }
  });
}

function nextToRender(): View | undefined {
  let best: View | undefined;
  let bestDist = Infinity;
  views.forEach((v, i) => {
    if (!v.near || v.rendered === scale || v.task) return;
    const d = Math.abs(i - current);
    if (d < bestDist) [best, bestDist] = [v, d];
  });
  return best;
}

async function renderPage(v: View) {
  const doc = pdf;
  const page = await proxy(v.slot.src);
  if (!v.vp) await setViewport(v);
  if (pdf !== doc) return;
  const s = scale;
  const vp = page.getViewport({ scale: s, rotation: v.vp!.rotation });
  let ratio = window.devicePixelRatio || 1;
  const maxPixels = 16_000_000;
  if (vp.width * vp.height * ratio * ratio > maxPixels) ratio = Math.sqrt(maxPixels / (vp.width * vp.height));

  // Draw off screen, then swap in, so zooming never flashes a blank page.
  const canvas = document.createElement("canvas");
  canvas.className = "pcanvas";
  canvas.width = Math.floor(vp.width * ratio);
  canvas.height = Math.floor(vp.height * ratio);
  v.task = page.render({
    canvas,
    canvasContext: canvas.getContext("2d", { alpha: false })!,
    viewport: vp,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
  });
  try {
    await v.task.promise;
  } catch (err) {
    report(`page ${v.slot.src + 1}`, err);
    v.task = null;
    return; // cancelled, or a broken page; the page stays blank rather than stopping the others
  }
  v.task = null;
  if (!v.near && !v.canvas) return;
  if (v.canvas) v.canvas.replaceWith(canvas);
  else v.el.prepend(canvas);
  v.canvas = canvas;
  v.rendered = s;
  if (!firstDrawn) {
    firstDrawn = true;
    note(`${fileName}: first page drawn ${Math.round(performance.now() - openedAt)} ms after opening`);
  }
  if (!v.textDone) renderText(v, page);
}

async function renderText(v: View, page: PDFPageProxy) {
  v.textDone = true;
  const layer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: v.textLayer,
    viewport: page.getViewport({ scale: 1, rotation: v.vp!.rotation }),
  });
  try {
    await layer.render();
    const end = document.createElement("div");
    end.className = "endOfContent";
    v.textLayer.append(end);
  } catch (err) {
    report(`text on page ${v.slot.src + 1}`, err); // the page still shows; it just can't be highlighted by text
  }
}

async function renderThumb(v: View) {
  v.thumbDone = true;
  const page = await proxy(v.slot.src);
  if (!v.vp) await setViewport(v);
  const ratio = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: (124 / v.vp!.width) * ratio, rotation: v.vp!.rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  try {
    await page.render({ canvas, canvasContext: canvas.getContext("2d", { alpha: false })!, viewport: vp }).promise;
    v.thumb.querySelector(".tpage")!.prepend(canvas);
  } catch (err) {
    report(`thumbnail ${v.slot.src + 1}`, err);
    v.thumbDone = false;
  }
}

// ---- Drawing marks ----

const pdfToView = (v: View, p: Pt) => v.vp!.convertToViewportPoint(p[0], p[1]) as Pt;
const viewToPdf = (v: View, p: Pt) => v.vp!.convertToPdfPoint(p[0], p[1]) as Pt;

function drawMarks(v: View) {
  if (!v.vp) return;
  const conv = (p: Pt) => pdfToView(v, p);
  let hl = "";
  let ink = "";
  const texts: HTMLElement[] = [];
  for (const m of marks) {
    if (m.page !== v.slot.src) continue;
    const sel = m.id === selected ? " selected" : "";
    if (m.kind === "highlight") {
      const rects = m.rects
        .map((r) => {
          const [a, b] = [conv([r[0], r[1]]), conv([r[2], r[3]])];
          const [x, y] = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
          return `<rect x="${x}" y="${y}" width="${Math.abs(a[0] - b[0])}" height="${Math.abs(a[1] - b[1])}" rx="1.5"/>`;
        })
        .join("");
      hl += `<g class="m${sel}" data-id="${m.id}" fill="${m.color}">${rects}</g>`;
    } else if (m.kind === "text") {
      const d = document.createElement("div");
      d.className = `tmark${sel}`;
      d.dataset.id = m.id;
      const [x, y] = conv(m.at);
      const turn = (((v.vp.rotation - m.rot) % 360) + 360) % 360;
      d.style.cssText = `left:calc(${x}px * var(--s));top:calc(${y}px * var(--s));font-size:calc(${m.size}px * var(--s));color:${m.color};transform:rotate(${turn}deg)`;
      d.textContent = m.text;
      if (editing?.mark.id === m.id) d.style.visibility = "hidden";
      texts.push(d);
    } else {
      const paths = m.strokes.map((s) => `<path d="${smoothPath(s.map(conv))}"/>`).join("");
      ink += `<g class="m${sel}" data-id="${m.id}" stroke="${m.color}" stroke-width="${m.width}">${paths}</g>`;
    }
  }
  v.hl.innerHTML = hl;
  v.ink.innerHTML = ink;
  v.thumbSvg.innerHTML = `<g class="thl">${hl}</g>${ink}`;
  const keep = editing && editing.v === v ? [editing.ta] : [];
  v.texts.replaceChildren(...texts, ...keep);

  // A dashed box around the selected highlight or stroke.
  const g = v.el.querySelector<SVGGElement>("g.m.selected");
  if (g) {
    const b = g.getBBox();
    const pad = 4 / scale;
    const box = document.createElementNS(SVG_NS, "rect");
    box.setAttribute("class", "selbox");
    box.setAttribute("x", String(b.x - pad));
    box.setAttribute("y", String(b.y - pad));
    box.setAttribute("width", String(b.width + pad * 2));
    box.setAttribute("height", String(b.height + pad * 2));
    box.setAttribute("rx", String(4 / scale));
    v.ink.append(box);
  }
}

function drawAll() {
  for (const v of views) drawMarks(v);
}

// ---- Changes and undo ----

const snapshot = (): Snapshot => ({ marks: structuredClone(marks), slots: structuredClone(slots), version });

function change(fn: () => void, used?: Tool, pagesChanged = false) {
  undoStack.push(snapshot());
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  fn();
  version = nextVersion++;
  if (used && !isScratch(filePath)) touchRecent(filePath, fileName, used);
  refresh(pagesChanged);
}

function refresh(pagesChanged: boolean) {
  if (pagesChanged) {
    buildViews();
    scheduleRender();
    fitIfTooWide();
  } else drawAll();
  chrome();
}

function restore(s: Snapshot) {
  const pagesChanged = JSON.stringify(s.slots) !== JSON.stringify(slots);
  marks = s.marks;
  slots = s.slots;
  version = s.version;
  if (selected && !marks.some((m) => m.id === selected)) selected = null;
  refresh(pagesChanged);
}

export function undo() {
  commitEditing();
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(snapshot());
  restore(s);
}

export function redo() {
  commitEditing();
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(snapshot());
  restore(s);
}

function select(id: string | null) {
  if (selected === id) return;
  selected = id;
  drawAll();
  renderSwatches();
}

export function deleteSelected() {
  if (!selected) return false;
  const id = selected;
  selected = null;
  change(() => (marks = marks.filter((m) => m.id !== id)));
  renderSwatches();
  return true;
}

/** The title, the unsaved-changes dot, the undo button and the "On this page" card. */
function chrome() {
  document.body.classList.toggle("dirty", isDirty());
  $<HTMLButtonElement>("undo").disabled = undoStack.length === 0;
  updateOnPage();
}

function updateOnPage() {
  const v = views[current];
  if (!v) return;
  const here = marks.filter((m) => m.page === v.slot.src);
  const count = (k: Mark["kind"]) => here.filter((m) => m.kind === k).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const rows = [
    [count("highlight"), toolColour.highlight, plural(count("highlight"), "highlight", "highlights")],
    [count("text"), toolColour.type, plural(count("text"), "typed field", "typed fields")],
    [count("ink"), toolColour.draw, plural(count("ink"), "drawing", "drawings")],
    [count("sign"), toolColour.sign, plural(count("sign"), "signature", "signatures")],
  ].filter(([n]) => n);
  onPageEl.innerHTML = `<h3>On this page <span>${current + 1} of ${views.length}</span></h3>${
    rows.length
      ? `<ul>${rows.map(([, c, label]) => `<li><i style="background:${c}"></i>${label}</li>`).join("")}</ul>`
      : `<p class="empty">Nothing marked yet. Pick a tool below, or press <kbd>H</kbd> <kbd>T</kbd> <kbd>D</kbd> <kbd>S</kbd>.</p>`
  }`;
  $("page-label").textContent = `${current + 1} / ${views.length}`;
}

// ---- Which page you're on ----

let trackQueued = false;
function trackCurrent() {
  if (trackQueued) return;
  trackQueued = true;
  requestAnimationFrame(() => {
    trackQueued = false;
    const line = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35;
    let i = 0;
    for (; i < views.length - 1; i++) if (views[i + 1].el.getBoundingClientRect().top > line) break;
    const changed = i !== current;
    current = i;
    views.forEach((v, j) => v.thumb.classList.toggle("active", j === i));
    if (changed) {
      views[i]?.thumb.scrollIntoView({ block: "nearest" });
      scheduleRender();
    }
    updateOnPage();
  });
}
scroller.addEventListener("scroll", trackCurrent, { passive: true });

export function goToPage(i: number) {
  const v = views[Math.max(0, Math.min(views.length - 1, i))];
  if (!v) return;
  scroller.scrollTo({ top: v.el.offsetTop - 28 });
}

// ---- Zoom ----

let zoomTimer = 0;

function applyScale() {
  pagesEl.style.setProperty("--s", String(scale));
  pagesEl.style.setProperty("--total-scale-factor", String(scale));
  $("zoom-label").textContent = `${Math.round(scale * 100)}%`;
}

export function zoomTo(next: number, anchor?: { x: number; y: number }) {
  next = Math.max(0.25, Math.min(5, next));
  if (!pdf || Math.abs(next - scale) < 0.001) return;
  const r = scroller.getBoundingClientRect();
  const ax = anchor ? anchor.x - r.left : scroller.clientWidth / 2;
  const ay = anchor ? anchor.y - r.top : scroller.clientHeight / 2;
  const ratio = next / scale;
  const [cx, cy] = [scroller.scrollLeft + ax, scroller.scrollTop + ay];
  scale = next;
  applyScale();
  scroller.scrollLeft = cx * ratio - ax;
  scroller.scrollTop = cy * ratio - ay;
  // Pages stretch at once; sharp redraws follow when the zooming settles.
  clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => {
    drawAll();
    scheduleRender();
  }, 140);
}

export const zoomBy = (factor: number) => zoomTo(scale * factor);

/** A page turned sideways can be wider than the window; zoom out so it fits. */
async function fitIfTooWide() {
  await Promise.all(views.filter((v) => !v.vp).map(setViewport));
  const widest = Math.max(...views.map((v) => v.vp?.width ?? 0), 1);
  if (widest * scale > scroller.clientWidth - 120) zoomTo(fitScale(widest));
}
export function zoomFit() {
  const w = Math.max(...views.map((v) => v.vp?.width ?? 0), 1);
  zoomTo(fitScale(w));
}

scroller.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomTo(scale * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
  },
  { passive: false },
);
// Safari reports trackpad pinches as gesture events.
let gestureBase = 1;
scroller.addEventListener("gesturestart", (e) => {
  e.preventDefault();
  gestureBase = scale;
});
scroller.addEventListener("gesturechange", (e) => {
  e.preventDefault();
  const g = e as unknown as { scale: number; clientX: number; clientY: number };
  zoomTo(gestureBase * g.scale, { x: g.clientX, y: g.clientY });
});

// ---- Tools ----

export function setTool(t: Tool) {
  commitEditing();
  tool = t;
  stamp = null;
  document.body.dataset.tool = t;
  for (const b of toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    b.classList.toggle("active", b.dataset.tool === t);
    b.setAttribute("aria-pressed", String(b.dataset.tool === t));
  }
  clearGhost();
  renderSwatches();
}

function selectedMark(): Mark | undefined {
  return marks.find((m) => m.id === selected);
}

const kindTool = (m: Mark): Tool =>
  m.kind === "highlight" ? "highlight" : m.kind === "text" ? "type" : m.kind === "ink" ? "draw" : "sign";

function renderSwatches() {
  const sel = selectedMark();
  const t = tool;
  const active = sel && kindTool(sel) === t ? sel.color : colourFor(t);
  let html = "";
  if (t === "pages") {
    html = `<span class="hint">Drag pages on the right to reorder. Hover one to turn or delete it.</span>`;
  } else {
    html = palettes[t]
      .map((c) => `<button class="sw${c === active ? " on" : ""}" data-colour="${c}" style="--c:${c}" title="Colour"></button>`)
      .join("");
    if (t === "type") {
      const size = sel?.kind === "text" ? sel.size : textSize();
      html += `<span class="sep"></span>${[10, 13, 18]
        .map((s, i) => `<button class="chip${s === size ? " on" : ""}" data-size="${s}">${["S", "M", "L"][i]}</button>`)
        .join("")}<button class="chip${stamp ? " on" : ""}" data-stamp title="Click the page to put today's date there">${icons.calendar}Date</button>`;
    }
    if (t === "draw") {
      html += `<span class="sep"></span><button class="chip${!prefs.thick ? " on" : ""}" data-thick="0">Fine</button><button class="chip${prefs.thick ? " on" : ""}" data-thick="1">Bold</button>`;
    }
    if (t === "sign") {
      html += `<span class="sep"></span><button class="chip" data-resign>${icons.pen}${loadSignature() ? "New signature" : "Draw signature"}</button>`;
    }
  }
  if (sel) html += `<span class="sep"></span><button class="chip danger" data-delete title="Delete (⌫)">${icons.trash}</button>`;
  swatches.innerHTML = html;
}

swatches.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the text being typed
swatches.addEventListener("click", async (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b) return;
  const sel = selectedMark();
  if (b.dataset.colour) {
    const c = b.dataset.colour;
    (prefs.colours ??= {})[tool] = c;
    savePrefs();
    if (editing) {
      editing.mark.color = c;
      editing.ta.style.color = c;
    }
    if (sel && kindTool(sel) === tool && sel.color !== c) change(() => (selectedMark()!.color = c));
  } else if (b.dataset.size) {
    const s = Number(b.dataset.size);
    prefs.textSize = s;
    savePrefs();
    if (editing) {
      editing.mark.size = s;
      styleEditor();
    } else if (sel?.kind === "text") change(() => ((selectedMark() as TextMark).size = s));
  } else if (b.hasAttribute("data-stamp")) {
    stamp = stamp ? null : new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
  } else if (b.dataset.thick) {
    prefs.thick = b.dataset.thick === "1";
    savePrefs();
  } else if (b.hasAttribute("data-resign")) {
    await drawSignature();
  } else if (b.hasAttribute("data-delete")) {
    deleteSelected();
  }
  renderSwatches();
});

toolbar.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("[data-tool]");
  if (!b) return;
  setTool(b.dataset.tool as Tool);
  b.blur();
});

// ---- Pointer input on pages ----

type Gesture =
  | { kind: "move"; v: View; id: string; start: Pt; orig: Mark; before: Snapshot; moved: boolean }
  | { kind: "draw"; v: View; pts: Pt[]; path: SVGPathElement }
  | { kind: "box"; v: View; start: Pt; rect: SVGRectElement }
  | { kind: "select" };

let gesture: Gesture | null = null;

function viewOf(target: EventTarget | null): View | undefined {
  const el = (target as Element | null)?.closest?.(".page");
  return el ? views.find((v) => v.el === el) : undefined;
}

/** Pointer position on the page at scale 1 (before converting to PDF space). */
function local(v: View, e: { clientX: number; clientY: number }): Pt {
  const r = v.el.getBoundingClientRect();
  return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
}

function hitTest(v: View, e: PointerEvent): Mark | undefined {
  const p = viewToPdf(v, local(v, e));
  const slack = 5 / scale;
  for (const el of v.texts.querySelectorAll<HTMLElement>(".tmark")) {
    const r = el.getBoundingClientRect();
    if (e.clientX >= r.left - 4 && e.clientX <= r.right + 4 && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
      return marks.find((m) => m.id === el.dataset.id);
    }
  }
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.page === v.slot.src && touches(m, p, slack)) return m;
  }
}

pagesEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !pdf) return;
  if ((e.target as Element).closest(".tedit")) return;
  const v = viewOf(e.target);
  if (!v?.vp) return;
  commitEditing();
  if (tool === "pages") return;

  const hit = tool === "draw" ? undefined : hitTest(v, e);
  if (hit) {
    e.preventDefault();
    select(hit.id);
    if (hit.kind !== "highlight") {
      v.el.setPointerCapture(e.pointerId);
      gesture = { kind: "move", v, id: hit.id, start: viewToPdf(v, local(v, e)), orig: structuredClone(hit), before: snapshot(), moved: false };
    }
    return;
  }
  select(null);

  if (tool === "highlight") {
    if ((e.target as Element).closest(".textLayer span")) {
      gesture = { kind: "select" };
      v.textLayer.classList.add("selecting");
      return;
    }
    e.preventDefault();
    document.body.classList.add("no-select");
    v.el.setPointerCapture(e.pointerId);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("class", "boxing");
    rect.setAttribute("fill", colourFor("highlight"));
    v.hl.append(rect);
    gesture = { kind: "box", v, start: local(v, e), rect };
  } else if (tool === "type") {
    e.preventDefault();
    const [x, y] = local(v, e);
    const size = textSize();
    const at = viewToPdf(v, [x, y - (size * LINE_HEIGHT) / 2]);
    const m: TextMark = { id: newId(), kind: "text", page: v.slot.src, color: colourFor("type"), at, rot: v.vp.rotation, size, text: stamp ?? "" };
    stamp = null;
    renderSwatches();
    openEditor(v, m, true);
  } else if (tool === "draw") {
    e.preventDefault();
    v.el.setPointerCapture(e.pointerId);
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("stroke", colourFor("draw"));
    path.setAttribute("stroke-width", String(prefs.thick ? 4 : 2));
    path.setAttribute("class", "live");
    v.ink.append(path);
    gesture = { kind: "draw", v, pts: [viewToPdf(v, local(v, e))], path };
  } else if (tool === "sign") {
    e.preventDefault();
    placeSignature(v, local(v, e));
  }
});

// A click on the page shouldn't move focus (it would close the text being typed),
// except when you're selecting text to highlight.
pagesEl.addEventListener("mousedown", (e) => {
  if ((e.target as Element).closest(".tedit")) return;
  if (tool === "highlight" && (e.target as Element).closest(".textLayer span")) return;
  e.preventDefault();
});

window.addEventListener("pointermove", (e) => {
  if (!gesture) {
    if (tool === "sign") ghost(e);
    return;
  }
  if (gesture.kind === "move") {
    const g = gesture;
    const p = viewToPdf(g.v, local(g.v, e));
    const [dx, dy] = [p[0] - g.start[0], p[1] - g.start[1]];
    if (!g.moved && Math.hypot(dx, dy) * scale < 3) return;
    g.moved = true;
    const moved = structuredClone(g.orig);
    moveMark(moved, dx, dy);
    marks = marks.map((m) => (m.id === g.id ? moved : m));
    drawMarks(g.v);
  } else if (gesture.kind === "draw") {
    const g = gesture;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) {
      const p = viewToPdf(g.v, local(g.v, ev));
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale > 1.2) g.pts.push(p);
    }
    g.path.setAttribute("d", smoothPath(g.pts.map((p) => pdfToView(g.v, p))));
  } else if (gesture.kind === "box") {
    const g = gesture;
    const [x, y] = local(g.v, e);
    g.rect.setAttribute("x", String(Math.min(x, g.start[0])));
    g.rect.setAttribute("y", String(Math.min(y, g.start[1])));
    g.rect.setAttribute("width", String(Math.abs(x - g.start[0])));
    g.rect.setAttribute("height", String(Math.abs(y - g.start[1])));
  }
});

window.addEventListener("pointerup", (e) => {
  const g = gesture;
  gesture = null;
  document.body.classList.remove("no-select");
  if (!g) return;
  if (g.kind === "move") {
    if (g.moved) {
      undoStack.push(g.before);
      redoStack = [];
      version = nextVersion++;
      chrome();
    } else {
      const m = marks.find((x) => x.id === g.id);
      if (m?.kind === "text" && tool === "type") openEditor(g.v, m, false);
    }
  } else if (g.kind === "draw") {
    g.path.remove();
    addStroke(g.v, g.pts);
  } else if (g.kind === "box") {
    g.rect.remove();
    const end = local(g.v, e);
    if (Math.abs(end[0] - g.start[0]) * scale > 4 && Math.abs(end[1] - g.start[1]) * scale > 4) {
      const a = viewToPdf(g.v, g.start);
      const b = viewToPdf(g.v, end);
      const rect: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      change(() => marks.push({ id: newId(), kind: "highlight", page: g.v.slot.src, color: colourFor("highlight"), rects: [rect] }), "highlight");
    }
  } else if (g.kind === "select") {
    for (const v of views) v.textLayer.classList.remove("selecting");
    setTimeout(() => {
      highlightSelection(); // the selection settles after mouseup
      resetEndOfContent();
    }, 0);
  }
});

// While you drag to select, keep the invisible end-of-content block just after
// the text being selected, so dragging into blank space extends the selection
// to the end of the line instead of losing it (the same trick pdf.js uses).
document.addEventListener("selectionchange", () => {
  if (gesture?.kind !== "select") return;
  const sel = window.getSelection();
  let node = sel?.focusNode ?? null;
  if (!sel || !node) return;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const span = node as HTMLElement;
  if (!span?.closest || span.classList.contains("endOfContent")) return;
  const layer = span.closest(".textLayer");
  const end = layer?.querySelector<HTMLElement>(".endOfContent");
  if (!layer || !end || span === layer) return;
  const backwards = !!(sel.anchorNode && sel.anchorNode.compareDocumentPosition(sel.focusNode!) & Node.DOCUMENT_POSITION_PRECEDING);
  end.style.userSelect = end.style.webkitUserSelect = "text";
  span.parentNode!.insertBefore(end, backwards ? span : span.nextSibling);
});

function resetEndOfContent() {
  for (const end of pagesEl.querySelectorAll<HTMLElement>(".endOfContent")) {
    end.style.userSelect = end.style.webkitUserSelect = "";
    end.closest(".textLayer")?.append(end);
  }
}

/** Strokes drawn in quick succession on one page become one drawing. */
function addStroke(v: View, pts: Pt[]) {
  const colour = colourFor("draw");
  const width = prefs.thick ? 4 : 2;
  const prev = lastStroke && marks.find((m) => m.id === lastStroke!.id);
  const join =
    prev && prev.kind === "ink" && prev.page === v.slot.src && prev.color === colour && prev.width === width && Date.now() - lastStroke!.at < 1500;
  if (join) {
    change(() => (marks.find((m) => m.id === prev.id) as InkMark).strokes.push(pts), "draw");
    lastStroke = { id: prev.id, at: Date.now() };
  } else {
    const m: InkMark = { id: newId(), kind: "ink", page: v.slot.src, color: colour, width, strokes: [pts] };
    change(() => marks.push(m), "draw");
    lastStroke = { id: m.id, at: Date.now() };
  }
}

/** Turns selected text into highlight bars, one line at a time. */
function highlightSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  sel.removeAllRanges();
  const added: Mark[] = [];
  for (const v of views) {
    if (!v.vp) continue;
    const box = v.el.getBoundingClientRect();
    const mine = rects.filter((r) => {
      const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
      return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
    });
    if (!mine.length) continue;
    // Merge pieces that sit on the same line.
    const lines: { l: number; t: number; r: number; b: number }[] = [];
    for (const r of mine.sort((a, b) => a.top - b.top || a.left - b.left)) {
      const cy = (r.top + r.bottom) / 2;
      const line = lines.find((x) => Math.abs((x.t + x.b) / 2 - cy) < Math.min(x.b - x.t, r.height) / 2 && r.left - x.r < r.height);
      if (line) {
        line.l = Math.min(line.l, r.left);
        line.r = Math.max(line.r, r.right);
        line.t = Math.min(line.t, r.top);
        line.b = Math.max(line.b, r.bottom);
      } else lines.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
    }
    const out: Rect[] = lines.map((x) => {
      const a = viewToPdf(v, [(x.l - box.left) / scale - 1, (x.t - box.top) / scale]);
      const b = viewToPdf(v, [(x.r - box.left) / scale + 1, (x.b - box.top) / scale]);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    });
    added.push({ id: newId(), kind: "highlight", page: v.slot.src, color: colourFor("highlight"), rects: out });
  }
  if (added.length) change(() => marks.push(...added), "highlight");
}

// ---- Typing ----

let editing: { v: View; ta: HTMLTextAreaElement; mark: TextMark; isNew: boolean } | null = null;

function styleEditor() {
  if (!editing) return;
  const { v, ta, mark } = editing;
  const [x, y] = pdfToView(v, mark.at);
  const turn = (((v.vp!.rotation - mark.rot) % 360) + 360) % 360;
  ta.style.cssText = `left:calc(${x}px * var(--s));top:calc(${y}px * var(--s));font-size:calc(${mark.size}px * var(--s));color:${mark.color};transform:rotate(${turn}deg);font-family:${TEXT_FONT}`;
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.width = `${ta.scrollWidth + 12}px`;
  ta.style.height = `${ta.scrollHeight}px`;
}

function openEditor(v: View, mark: TextMark, isNew: boolean) {
  const ta = document.createElement("textarea");
  ta.className = "tedit";
  ta.wrap = "off";
  ta.spellcheck = true;
  ta.value = mark.text;
  editing = { v, ta, mark: structuredClone(mark), isNew };
  v.texts.append(ta);
  v.texts.querySelector<HTMLElement>(`.tmark[data-id="${mark.id}"]`)?.style.setProperty("visibility", "hidden");
  styleEditor();
  ta.addEventListener("input", styleEditor);
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      commitEditing();
    }
  });
  ta.addEventListener("blur", () => commitEditing());
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

export function commitEditing() {
  if (!editing) return;
  const { v, ta, mark, isNew } = editing;
  editing = null;
  const text = ta.value.replace(/\s+$/, "");
  ta.remove();
  const old = marks.find((m) => m.id === mark.id) as TextMark | undefined;
  if (isNew) {
    if (text) change(() => marks.push({ ...mark, text }), "type");
    else drawMarks(v);
  } else if (!text) {
    change(() => (marks = marks.filter((m) => m.id !== mark.id)));
  } else if (old && (text !== old.text || mark.size !== old.size || mark.color !== old.color)) {
    change(() => Object.assign(marks.find((m) => m.id === mark.id)!, { text, size: mark.size, color: mark.color }), "type");
  } else drawMarks(v);
}

// ---- Signing ----

const SIGN_WIDTH = 150;

function signaturePoints(v: View, at: Pt): Pt[][] | null {
  const sig = loadSignature();
  if (!sig) return null;
  const k = SIGN_WIDTH / Math.max(sig.w, sig.h * 2.5);
  // Centred across the pointer, sitting on it like a pen on a signature line.
  return sig.strokes.map((s) => s.map(([x, y]) => [at[0] + (x - sig.w / 2) * k, at[1] + (y - sig.h * 0.8) * k] as Pt));
}

async function placeSignature(v: View, at: Pt) {
  if (!loadSignature() && !(await drawSignature())) return;
  renderSwatches();
  const pts = signaturePoints(v, at)!;
  const m: InkMark = { id: newId(), kind: "sign", page: v.slot.src, color: colourFor("sign"), width: 1.6, strokes: pts.map((s) => s.map((p) => viewToPdf(v, p))) };
  change(() => marks.push(m), "sign");
  select(m.id);
}

let ghostView: View | null = null;
function clearGhost() {
  ghostView?.ink.querySelector(".ghost")?.remove();
  ghostView = null;
}
/** A faint copy of your signature follows the pointer, so you see where it lands. */
function ghost(e: PointerEvent) {
  const v = viewOf(e.target);
  if (v !== ghostView) clearGhost();
  if (!v?.vp || (e.target as Element).closest(".tmark")) return;
  const pts = signaturePoints(v, local(v, e));
  if (!pts) return;
  ghostView = v;
  let g = v.ink.querySelector<SVGGElement>(".ghost");
  if (!g) {
    g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "ghost");
    g.setAttribute("stroke", colourFor("sign"));
    g.setAttribute("stroke-width", "1.6");
    v.ink.append(g);
  }
  g.innerHTML = pts.map((s) => `<path d="${smoothPath(s)}"/>`).join("");
}
pagesEl.addEventListener("pointerleave", clearGhost);

// ---- Pages: turn, delete, reorder from the thumbnail rail ----

let railDrag: { from: number; y0: number; moved: boolean; bar: HTMLDivElement; to: number } | null = null;

thumbsEl.addEventListener("click", (e) => {
  const act = (e.target as Element).closest<HTMLButtonElement>("[data-act]");
  const thumb = (e.target as Element).closest<HTMLElement>(".thumb");
  if (!thumb) return;
  const i = views.findIndex((v) => v.thumb === thumb);
  if (act?.dataset.act === "rotate") change(() => (slots[i].rot = (slots[i].rot + 90) % 360), "pages", true);
  else if (act?.dataset.act === "delete") {
    if (slots.length === 1) return toast("A PDF needs at least one page");
    change(() => slots.splice(i, 1), "pages", true);
  }
});

thumbsEl.addEventListener("pointerdown", (e) => {
  const thumb = (e.target as Element).closest<HTMLElement>(".thumb");
  if (!thumb || e.button !== 0 || (e.target as Element).closest("[data-act]")) return;
  const from = views.findIndex((v) => v.thumb === thumb);
  if (tool !== "pages") return goToPage(from);
  e.preventDefault();
  thumbsEl.setPointerCapture(e.pointerId);
  const bar = document.createElement("div");
  bar.className = "dropbar";
  railDrag = { from, y0: e.clientY, moved: false, bar, to: from };
});

thumbsEl.addEventListener("pointermove", (e) => {
  const d = railDrag;
  if (!d) return;
  if (!d.moved && Math.abs(e.clientY - d.y0) < 5) return;
  if (!d.moved) {
    d.moved = true;
    views[d.from].thumb.classList.add("lifted");
    thumbsEl.append(d.bar);
  }
  views[d.from].thumb.style.transform = `translateY(${e.clientY - d.y0}px)`;
  const tops = views.map((v) => {
    const r = v.thumb.getBoundingClientRect();
    return r.top + r.height / 2;
  });
  let to = tops.findIndex((mid, i) => i !== d.from && e.clientY < mid);
  if (to < 0) to = views.length;
  d.to = to;
  const ref = views[Math.min(to, views.length - 1)].thumb;
  const top = to >= views.length ? ref.offsetTop + ref.offsetHeight + 6 : ref.offsetTop - 8;
  d.bar.style.top = `${top}px`;
});

thumbsEl.addEventListener("pointerup", () => {
  const d = railDrag;
  railDrag = null;
  if (!d) return;
  d.bar.remove();
  const t = views[d.from]?.thumb;
  if (t) {
    t.classList.remove("lifted");
    t.style.transform = "";
  }
  if (!d.moved) return goToPage(d.from);
  const to = d.to > d.from ? d.to - 1 : d.to;
  if (to === d.from) return;
  change(() => {
    const [s] = slots.splice(d.from, 1);
    slots.splice(to, 0, s);
  }, "pages", true);
});

// ---- Saving ----

export async function save(copy = false): Promise<boolean> {
  if (!pdf || saving) return false;
  commitEditing();
  let target = filePath;
  if (copy || isScratch(filePath) || filePath.startsWith("browser:")) {
    const suggested = copy ? fileName.replace(/\.pdf$/i, "") + " (marked up).pdf" : fileName;
    const picked = await pickSavePath(suggested);
    if (!picked) return false;
    target = picked.toLowerCase().endsWith(".pdf") ? picked : `${picked}.pdf`;
  }
  saving = true;
  const button = $<HTMLButtonElement>("save");
  button.classList.add("busy");
  try {
    const { buildPdf } = await import("./save");
    const bytes = await buildPdf(original, marks, slots);
    await writePdf(target, bytes);
    if (!copy) {
      savedVersion = version;
      if (target !== filePath) {
        filePath = target;
        fileName = basename(target);
        $("doc-title").textContent = fileName;
      }
      touchRecent(filePath, fileName);
    }
    chrome();
    toast(copy ? `Saved a copy as ${basename(target)}` : "Saved");
    return true;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    toast(/encrypt/i.test(msg) ? "This PDF is locked against changes, so Pronto can't save into it." : `Couldn't save: ${msg}`, "error");
    return false;
  } finally {
    saving = false;
    button.classList.remove("busy");
  }
}

// Re-fit nothing on resize, but keep the page tracker honest.
window.addEventListener("resize", trackCurrent);

// Development only: lets tests read the state and build the saved file.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __pronto: {
      state: () => ({ marks, slots, scale, tool }),
      build: async () => (await import("./save")).buildPdf(original, marks, slots),
    },
  });
}
