import "@fontsource-variable/bricolage-grotesque/wdth.css";
import "@fontsource-variable/figtree/index.css";
import "./styles.css";

import * as editor from "./editor";
import { initHome, renderRecents } from "./home";
import { icons, mark } from "./icons";
import { clipboardPdf, inApp, keepBrowserFile, pickPdf, readPdf, takePending, basename, isScratch } from "./native";
import { touchRecent, type Tool } from "./recents";
import { choose, toast } from "./ui";

// ---- Static pieces of the page ----

for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  el.insertAdjacentHTML("afterbegin", icons[el.dataset.icon as keyof typeof icons]);
}
for (const el of document.querySelectorAll<HTMLElement>("[data-mark]")) el.innerHTML = mark();

function show(view: "home" | "editor") {
  document.body.dataset.view = view;
}

// ---- Opening files ----

let opening = false;

/** Asks what to do with unsaved changes. Returns false if you'd rather stay. */
async function settleChanges(): Promise<boolean> {
  if (!editor.isDirty()) return true;
  const name = basename(editor.openPath());
  const pick = await choose(`Save changes to ${name}?`, "Your marks will be lost if you don't save them.", [
    { id: "discard", label: "Don't save", style: "quiet" },
    { id: "cancel", label: "Cancel", style: "plain" },
    { id: "save", label: "Save", style: "primary" },
  ]);
  if (pick === "save") return editor.save();
  return pick === "discard";
}

async function openFile(path: string) {
  if (opening) return;
  if (editor.isOpen() && editor.openPath() === path) return show("editor");
  if (!(await settleChanges())) return;
  opening = true;
  try {
    const bytes = await readPdf(path);
    show("editor");
    await editor.open(path, bytes);
    if (!isScratch(path)) touchRecent(path, basename(path));
  } catch (err) {
    await editor.close();
    show("home");
    renderRecents(openFile);
    const msg = String((err as Error)?.message ?? err);
    toast(/password/i.test(msg) ? "Pronto needs the password to open that PDF." : /Invalid PDF/i.test(msg) ? "That file isn't a PDF Pronto can read." : msg, "error");
  } finally {
    opening = false;
  }
}

async function openPicker() {
  const path = await pickPdf();
  if (path) openFile(path);
}

async function pasteFromClipboard() {
  const path = await clipboardPdf();
  if (path) openFile(path);
  else toast("There's no PDF on the clipboard. Copy one in Finder first.");
}

async function goHome() {
  if (!(await settleChanges())) return;
  await editor.close();
  show("home");
  renderRecents(openFile);
}

async function openPending() {
  const [first] = await takePending();
  if (first) openFile(first);
}

// ---- Buttons ----

initHome(openFile);
document.getElementById("open-btn")!.onclick = openPicker;
document.getElementById("paste-btn")!.onclick = pasteFromClipboard;
document.getElementById("back")!.onclick = goHome;
document.getElementById("undo")!.onclick = () => editor.undo();
document.getElementById("share")!.onclick = () => editor.save(true);
document.getElementById("save")!.onclick = () => editor.save();
document.getElementById("zoom-in")!.onclick = () => editor.zoomBy(1.2);
document.getElementById("zoom-out")!.onclick = () => editor.zoomBy(1 / 1.2);
document.getElementById("zoom-label")!.onclick = () => editor.zoomFit();

// ---- Keyboard ----

const toolKeys: Record<string, Tool> = { h: "highlight", t: "type", d: "draw", s: "sign", p: "pages", 1: "highlight", 2: "type", 3: "draw", 4: "sign", 5: "pages" };

window.addEventListener("keydown", (e) => {
  const typing = (e.target as Element).closest?.("input, textarea, [contenteditable]");
  const cmd = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  const inEditor = document.body.dataset.view === "editor";

  if (cmd && k === "o") return e.preventDefault(), openPicker();
  if (!inEditor) {
    if (cmd && k === "v" && !typing) return e.preventDefault(), pasteFromClipboard();
    return;
  }
  if (cmd && k === "s") return e.preventDefault(), editor.save(e.shiftKey);
  if (cmd && k === "z" && !typing) return e.preventDefault(), e.shiftKey ? editor.redo() : editor.undo();
  if (cmd && k === "y" && !typing) return e.preventDefault(), editor.redo();
  if (cmd && (k === "=" || k === "+")) return e.preventDefault(), editor.zoomBy(1.2);
  if (cmd && k === "-") return e.preventDefault(), editor.zoomBy(1 / 1.2);
  if (cmd && k === "0") return e.preventDefault(), editor.zoomFit();
  if (cmd && k === "w") return e.preventDefault(), goHome();
  if (typing || cmd || e.altKey) return;
  if (toolKeys[k]) return editor.setTool(toolKeys[k]);
  if ((k === "backspace" || k === "delete") && editor.deleteSelected()) return e.preventDefault();
});

// ---- Dropping files anywhere ----

if (inApp) {
  import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") document.body.classList.add("dragging");
      else document.body.classList.remove("dragging");
      if (p.type === "drop") {
        const pdf = p.paths.find((x) => x.toLowerCase().endsWith(".pdf"));
        if (pdf) openFile(pdf);
        else if (p.paths.length) toast("Pronto opens PDFs. That wasn't one.");
      }
    }),
  );
  import("@tauri-apps/api/event").then(({ listen }) => listen("pending-files", openPending));
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    win.onCloseRequested(async (e) => {
      if (!editor.isDirty()) return;
      e.preventDefault();
      if (await settleChanges()) await win.destroy();
    });
  });
  openPending();
} else {
  // Browser mode (development): plain HTML drag and drop.
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    document.body.classList.remove("dragging");
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (file) openFile(await keepBrowserFile(file));
  });
  const demo = new URLSearchParams(location.search).get("open");
  if (demo) openFile(demo);
}

show("home");
