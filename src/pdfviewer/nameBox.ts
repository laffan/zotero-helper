// The small box that names something on a page as it is made — a
// bookmark (bookmarks.ts), a section (dividers.ts) — or renames or
// removes one already there. Made: the name filled in and selected,
// Enter (or Add) keeps it. Existing: its name, to Save, or Remove.
// Escape or a press elsewhere drops the box, and `dropped` hears of it.
// One box at a time per viewer. A section's box also offers, beneath,
// the sections it can be nested under (`choice`), when there are any.

export interface NameBoxOpen {
  /** What the box sits by, and on which side of it. Under the anchor:
   *  their right edges lined up ("right"), or left edges ("left"). */
  anchor: HTMLElement;
  align: "left" | "right";
  /** For the field's label: "Bookmark name". */
  label: string;
  name: string;
  /** Renaming an existing one (Save, and Remove) rather than adding. */
  existing: boolean;
  /** A dropdown under the name: its label, its options (`level` indents
   *  one), and the one chosen to begin with. Its value goes to `save`. */
  choice?: { label: string; options: { value: string; text: string; level?: number }[]; value: string };
  save: (name: string, choice?: string) => void;
  remove?: () => void;
  /** Closed without Add, Save or Remove. */
  dropped?: () => void;
}

export function createNameBox(host: HTMLElement) {
  let box: { form: HTMLFormElement; dropped?: () => void } | null = null;

  /** `kept`: closed by its own Add, Save or Remove. */
  function close(kept = false): void {
    if (!box) return;
    const was = box;
    box = null;
    was.form.remove();
    document.removeEventListener("pointerdown", onOutside, true);
    if (!kept) was.dropped?.();
  }
  function onOutside(e: PointerEvent): void {
    if (box && !box.form.contains(e.target as Node)) close();
  }

  function open(o: NameBoxOpen): void {
    close();
    const form = document.createElement("form");
    form.className = "pdf-bookmark-box";
    form.innerHTML =
      `<input type="text" /><button type="submit">${o.existing ? "Save" : "Add"}</button>` +
      (o.remove ? `<button type="button" class="pdf-bookmark-remove">Remove</button>` : "");
    const input = form.querySelector("input")!;
    input.setAttribute("aria-label", o.label);
    input.value = o.name;
    let select: HTMLSelectElement | null = null;
    if (o.choice && o.choice.options.length > 1) {
      const row = document.createElement("label");
      row.className = "pdf-name-box-choice";
      row.append(o.choice.label);
      select = document.createElement("select");
      for (const opt of o.choice.options) {
        const el = document.createElement("option");
        el.value = opt.value;
        // Indented by its depth (non-breaking spaces: a select keeps them).
        el.textContent = `${"\u00a0\u00a0\u00a0".repeat(opt.level ?? 0)}${opt.text}`;
        select.appendChild(el);
      }
      select.value = o.choice.value;
      row.appendChild(select);
      form.appendChild(row);
    }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim() || o.name;
      close(true);
      o.save(name, select?.value);
    });
    form.querySelector(".pdf-bookmark-remove")?.addEventListener("click", () => {
      close(true);
      o.remove?.();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Before reading mode's own Escape, which would leave it.
      e.stopPropagation();
      close();
    });
    host.appendChild(form);
    box = { form, dropped: o.dropped };
    // Under the anchor, kept inside the viewer.
    const h = host.getBoundingClientRect();
    const a = o.anchor.getBoundingClientRect();
    const want = o.align === "right" ? a.right - h.left - form.offsetWidth : a.left - h.left;
    form.style.left = `${Math.max(8, Math.min(want, h.width - form.offsetWidth - 8))}px`;
    form.style.top = `${Math.max(8, Math.min(a.bottom - h.top + 6, h.height - form.offsetHeight - 8))}px`;
    input.focus();
    input.select();
    document.addEventListener("pointerdown", onOutside, true);
  }

  return { open, close: () => close(), isOpen: () => box !== null };
}

export type NameBox = ReturnType<typeof createNameBox>;
