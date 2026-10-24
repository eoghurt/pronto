// Small shared pieces: toasts and in-app dialogs that match the rest of Pronto.

let toastTimer = 0;

export function toast(message: string, tone: "plain" | "error" = "plain") {
  const el = document.getElementById("toast")!;
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), tone === "error" ? 5000 : 1800);
}

export interface Choice {
  id: string;
  label: string;
  style?: "primary" | "plain" | "quiet";
}

/** A dialog with a few buttons; resolves with the chosen id, or "cancel" on Escape. */
export function choose(title: string, body: string, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <h2></h2><p></p><div class="dialog-buttons"></div></div>`;
    scrim.querySelector("h2")!.textContent = title;
    scrim.querySelector("p")!.textContent = body;
    const row = scrim.querySelector(".dialog-buttons")!;
    const done = (id: string) => {
      scrim.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(id);
    };
    for (const c of choices) {
      const b = document.createElement("button");
      b.className = `btn ${c.style ?? "plain"}`;
      b.textContent = c.label;
      b.onclick = () => done(c.id);
      row.append(b);
    }
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") done("cancel");
      if (e.key === "Enter") done(choices.find((c) => c.style === "primary")?.id ?? choices[0].id);
    };
    window.addEventListener("keydown", onKey, true);
    document.body.append(scrim);
    (row.querySelector(".primary") as HTMLElement | null)?.focus();
  });
}

/** Asks for one line of text (used for PDF passwords). */
export function askText(title: string, body: string, secret = false): Promise<string | null> {
  return new Promise((resolve) => {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<form class="dialog"><h2></h2><p></p>
      <input class="field" autocomplete="off" spellcheck="false" />
      <div class="dialog-buttons"><button type="button" class="btn quiet">Cancel</button><button class="btn primary">Open</button></div></form>`;
    scrim.querySelector("h2")!.textContent = title;
    scrim.querySelector("p")!.textContent = body;
    const input = scrim.querySelector("input")!;
    input.type = secret ? "password" : "text";
    const done = (v: string | null) => {
      scrim.remove();
      resolve(v);
    };
    scrim.querySelector("form")!.onsubmit = (e) => {
      e.preventDefault();
      done(input.value);
    };
    scrim.querySelector(".quiet")!.addEventListener("click", () => done(null));
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") done(null);
    };
    document.body.append(scrim);
    input.focus();
  });
}
