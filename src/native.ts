// The bridge to the Rust side. Outside Tauri (a plain browser, used while
// developing) the same calls fall back to browser equivalents.

import { invoke, isTauri } from "@tauri-apps/api/core";

export const inApp = isTauri();

/** Files picked in browser mode, kept by their pretend path. */
const browserFiles = new Map<string, Uint8Array>();

export async function readPdf(path: string): Promise<Uint8Array> {
  if (!inApp) {
    const kept = browserFiles.get(path);
    if (kept) return kept.slice();
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Couldn't open ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await invoke<ArrayBuffer>("read_pdf", { path }));
}

export async function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  if (!inApp) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    a.download = basename(path);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return;
  }
  await invoke("write_pdf", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}

export async function fileExists(path: string): Promise<boolean> {
  if (!inApp) return browserFiles.has(path) || !path.startsWith("browser:");
  return invoke<boolean>("file_exists", { path });
}

export async function takePending(): Promise<string[]> {
  return inApp ? invoke<string[]>("take_pending") : [];
}

export async function clipboardPdf(): Promise<string | null> {
  return inApp ? invoke<string | null>("clipboard_pdf") : null;
}

export async function pickPdf(): Promise<string | null> {
  if (inApp) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
    return typeof picked === "string" ? picked : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await keepBrowserFile(file));
    };
    input.click();
  });
}

export async function keepBrowserFile(file: File): Promise<string> {
  const path = `browser:${file.name}`;
  browserFiles.set(path, new Uint8Array(await file.arrayBuffer()));
  return path;
}

export async function pickSavePath(suggested: string): Promise<string | null> {
  if (!inApp) return `browser:${basename(suggested)}`;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] });
}

export function basename(path: string): string {
  return path.replace(/^browser:/, "").split(/[\\/]/).pop() || path;
}

/** Pasted PDF data lands in the app's cache folder, so it has no real home yet. */
export function isScratch(path: string): boolean {
  return /\/Caches\/com\.eoghurt\.pronto\/Pasted PDF \d+\.pdf$/.test(path);
}

/** Records an error that the interface recovers from, so it can still be found. */
export function report(where: string, err: unknown) {
  const e = err as { name?: string; message?: string; stack?: string };
  if (e?.name === "RenderingCancelledException") return;
  const text = `${where}: ${e?.name ?? ""} ${e?.message ?? String(err)}\n${e?.stack ?? ""}`;
  console.error(text);
  if (inApp) invoke("log", { message: text }).catch(() => {});
}

/** A line in the terminal log (only visible when Pronto is started from Terminal). */
export function note(text: string) {
  if (inApp) invoke("log", { message: text }).catch(() => {});
}

/** Whether double-clicking a PDF opens Pronto. Always true outside the app. */
export async function isDefaultPdfApp(): Promise<boolean> {
  return inApp ? invoke<boolean>("is_default_pdf_app") : true;
}

export async function makeDefaultPdfApp(): Promise<void> {
  if (inApp) await invoke("make_default_pdf_app");
}
