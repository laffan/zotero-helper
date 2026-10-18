// A look-up's answer: the selected word and its definition, in a small
// box just above the selection bar (below it when there is no room) —
// "Looking up…" while the AI answers. A one-off: it goes with the bar
// (the selection dismissed, the pages scrolled), and its word is kept in
// Words by the host (lib/ai/lookup.ts), not here. The same box shows a
// word looked up before over the word itself, when its mark in the
// pages is tapped (annotating.ts).

export function createLookupPopup(root: HTMLElement) {
  const box = document.createElement("div");
  box.className = "pdf-lookup";
  box.style.display = "none";
  const word = document.createElement("div");
  word.className = "pdf-lookup-word";
  const body = document.createElement("div");
  body.className = "pdf-lookup-body";
  box.append(word, body);
  root.appendChild(box);
  // A press on it keeps the selection (and so the bar and itself).
  box.addEventListener("pointerdown", (e) => e.preventDefault());

  let token = 0;
  let anchor: DOMRect | null = null;

  function place(): void {
    if (!anchor) return;
    const host = root.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - host.left - w / 2), host.width - w - 8);
    const above = anchor.top - host.top - h - 6;
    box.style.left = `${left}px`;
    box.style.top = `${above >= 8 ? above : anchor.bottom - host.top + 6}px`;
  }

  return {
    /** Show `text` looked up, `answer` to come, over the bar at `at`. */
    show(text: string, answer: Promise<string>, at: DOMRect): void {
      const my = ++token;
      anchor = at;
      word.textContent = text.replace(/\s+/g, " ").trim();
      body.textContent = "Looking up…";
      box.classList.add("loading");
      box.style.display = "";
      place();
      answer
        .then((d) => {
          if (my !== token) return;
          body.textContent = d;
        })
        .catch((e) => {
          if (my !== token) return;
          body.textContent = `Couldn't look it up: ${e}`;
        })
        .finally(() => {
          if (my !== token) return;
          box.classList.remove("loading");
          place();
        });
    },
    /** Show a definition already known, over `at` (a word marked in
     *  the pages). */
    showKnown(text: string, definition: string, at: DOMRect): void {
      this.show(text, Promise.resolve(definition), at);
    },
    hide(): void {
      token++;
      anchor = null;
      box.style.display = "none";
    },
    destroy: () => box.remove(),
  };
}
