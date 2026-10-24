// Recently opened files, newest first, each remembering the last tool used on it.

export type Tool = "highlight" | "type" | "draw" | "sign" | "pages";
export type RecentTool = Tool | "open";

export interface Recent {
  path: string;
  name: string;
  tool: RecentTool;
  at: number;
}

const KEY = "pronto.recents";
const MAX = 30;

export function loadRecents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked: recents are a convenience */
  }
}

/** Moves a file to the top. A plain open keeps the tool it was last marked with. */
export function touchRecent(path: string, name: string, tool: RecentTool = "open") {
  const list = loadRecents();
  const old = list.find((r) => r.path === path);
  const kept = tool === "open" && old ? old.tool : tool;
  store([{ path, name, tool: kept, at: Date.now() }, ...list.filter((r) => r.path !== path)]);
}

export function forgetRecent(path: string) {
  store(loadRecents().filter((r) => r.path !== path));
}

export const toolLabel: Record<RecentTool, string> = {
  highlight: "Highlighted",
  type: "Typed notes",
  draw: "Drew on it",
  sign: "Signed",
  pages: "Pages reordered",
  open: "Opened",
};

export function whenLabel(at: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(Date.now()) - day(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(at).toLocaleDateString("en-AU", { weekday: "long" });
  if (days < 14) return "Last week";
  return new Date(at).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}
