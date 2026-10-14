// One keydown listener for every shortcut (bindings.ts). It runs after
// the focused element's own handlers, so a field, the notes editor or
// a popup that spends a key (preventDefault) keeps it.
//
// Which actions listen depends on where the reader is: the general
// ones always, then the PDF viewer's while a PDF is open, else the
// library's. Nothing listens on the settings page or under a modal.
// While text is being typed — in a field, the notes, a comment — only
// combos with ⌘ / Ctrl / ⌥ count: a bare letter, an arrow, Tab or
// Return there is typing; Escape leaves the field.
//
// That makes it matter where the focus is, and iPadOS keeps it where
// the desktop would let it go: tapping something that can't take focus
// (an item row, a page of the PDF) leaves the notes or a search field
// focused, so every key after it would count as typing — the keyboard
// would seem dead until the field went away. So a press outside a text
// field lets the field go, as a click does on the desktop.
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

/** Let a text field go when the pointer goes down outside it. */
function releaseTextFocus(target: EventTarget | null): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !typingIn(active)) return;
  if (target instanceof Node && active.contains(target)) return;
  if (target instanceof Element && target.closest(TEXT_INPUT)) return;
  active.blur();
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
  if (typingIn(e.target) && !hasCommandModifier(combo)) {
    // Escape out of a field (a popup in it, like the "?" menu, spends
    // the key first), so the shortcuts are back without a tap.
    if (combo === "escape" && e.target instanceof HTMLElement) e.target.closest<HTMLElement>(TEXT_INPUT)?.blur();
    return;
  }
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
  // The pane clicked in is the one the arrows then move in, and a text
  // field pressed outside of lets go of the keyboard.
  window.addEventListener(
    "pointerdown",
    (e) => {
      releaseTextFocus(e.target);
      followPointer(e.target);
    },
    true,
  );
}
