// The open screen: one drop zone, one button, and the files you had open.

import { fileExists } from "./native";
import { forgetRecent, loadRecents, toolLabel, whenLabel, type Recent } from "./recents";
import { toolColour } from "./marks";

const list = document.getElementById("recent-list")!;
const more = document.getElementById("recent-more") as HTMLButtonElement;
let showAll = false;

const cardColour = (r: Recent) => (r.tool === "open" ? "#FFFFFF" : toolColour[r.tool]);

function docTile(r: Recent) {
  const accent = r.tool === "open" ? "#E9DCCB" : toolColour[r.tool];
  const lines =
    r.tool === "sign"
      ? `<i></i><i class="short"></i><i class="foot" style="background:${accent}"></i>`
      : r.tool === "highlight"
        ? `<i style="background:${accent}"></i><i></i><i class="short"></i>`
        : r.tool === "type"
          ? `<i></i><i class="short" style="background:${accent}"></i><i></i>`
          : `<i></i><i class="short"></i><i></i>`;
  return `<span class="tile">${lines}</span>`;
}

export function renderRecents(open: (path: string) => void) {
  const all = loadRecents();
  const shown = showAll ? all : all.slice(0, 4);
  more.hidden = all.length <= 4;
  more.textContent = showAll ? "Show fewer" : "Show all recent files";
  if (!all.length) {
    list.innerHTML = `<li class="recent-empty">Files you open show up here, coloured by the last tool you used on them.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const r of shown) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.className = "recent";
    b.style.setProperty("--c", cardColour(r));
    if (r.tool === "type") b.classList.add("on-dark");
    if (r.tool === "open") b.classList.add("plain-card");
    b.title = r.path;
    b.innerHTML = `${docTile(r)}<span class="recent-text"><strong></strong><small>${toolLabel[r.tool]} · ${whenLabel(r.at)}</small></span>
      <span class="forget" role="button" title="Remove from recent">×</span>`;
    b.querySelector("strong")!.textContent = r.name.replace(/\.pdf$/i, "");
    b.onclick = async (e) => {
      if ((e.target as Element).closest(".forget")) {
        forgetRecent(r.path);
        return renderRecents(open);
      }
      if (!(await fileExists(r.path))) {
        b.classList.add("missing");
        b.querySelector("small")!.textContent = "Moved or deleted. Click × to remove it.";
        return;
      }
      open(r.path);
    };
    li.append(b);
    list.append(li);
  }
}

export function initHome(open: (path: string) => void) {
  more.onclick = () => {
    showAll = !showAll;
    renderRecents(open);
  };
  renderRecents(open);
}
