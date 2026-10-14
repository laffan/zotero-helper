// One keydown listener for every shortcut (bindings.ts). It runs after
// the focused element's own handlers, so a field, the notes editor or
// a popup that spends a key (preventDefault) keeps it.
//
// Which actions listen depends on where the reader is: the general
// ones always, then the PDF viewer's while a PDF is open, else the
// library's. Nothing listens on the settings page or under a modal.
// While text is being typed — in a field, the notes, a comment — only
// combos with ⌘ / Ctrl / ⌥ count: a bare letter, an arrow, Tab or
// Return there is typing.
import { useStore } from "../store";
import { ACTIONS, bindingsOf, eventCombo, hasCommandModifier, type ShortcutContext } from "./bindings";
import { followPointer } from "./panes";
import { RUN } from "./run";

const TEXT_INPUT = "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor";
const NOT_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file"]);

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest(TEXT_INPUT);
  if (!field) return false;
  return !(field instanceof HTMLInputElement && NOT_TEXT_INPUTS.has(field.type));
}

/** Return or Space on a focused button is that button's press. */
function pressingControl(target: EventTarget | null, combo: string): boolean {
  if (combo !== "enter" && combo !== "space") return false;
  return target instanceof Element && Boolean(target.closest("button, a[href], [role='button'], summary"));
}

function blocked(): boolean {
  const s = useStore.getState();
  return s.view !== "main" || s.modal !== null || Boolean(document.querySelector(".modal-backdrop"));
}

/** The action bound to `combo` in the contexts listening now; a
 *  context's own action wins over a general one on the same key. */
function actionFor(combo: string, contexts: ShortcutContext[]): string | null {
  for (const ctx of contexts) {
    const hit = ACTIONS.find((a) => a.context === ctx && bindingsOf(a.id).includes(combo));
    if (hit) return hit.id;
  }
  return null;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || blocked()) return;
  const combo = eventCombo(e);
  if (!combo) return;
  if (typingIn(e.target) && !hasCommandModifier(combo)) return;
  if (pressingControl(e.target, combo)) return;
  const contexts: ShortcutContext[] = useStore.getState().reading ? ["pdf", "general"] : ["list", "general"];
  const id = actionFor(combo, contexts);
  const run = id ? RUN[id] : undefined;
  if (!run) return;
  // Held arrows repeat; a held letter shouldn't flip a mode on and off.
  if (e.repeat && !combo.includes("arrow")) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  run();
}

let installed = false;

/** Start listening. Called once, from App. */
export function installShortcuts(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("keydown", onKeydown);
  // The pane clicked in is the one the arrows then move in.
  window.addEventListener("pointerdown", (e) => followPointer(e.target), true);
}
