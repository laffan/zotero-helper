// The keyboard shortcuts: every action that has one, the keys it is
// bound to by default, and the reader's own changes to them (Settings →
// Keyboard Shortcuts), kept on this device.
//
// A binding is a combo string — modifiers in a fixed order, then the
// key, joined by "+": "mod+shift+\\", "shift+f", "arrowright", "1".
// "mod" is ⌘ on Apple platforms and Ctrl elsewhere; "ctrl" is the
// Control key on Apple platforms only. Keys are named by what the key
// is, not what it types: ⇧\ is "shift+\\", not "|" (eventCombo).
//
// Actions belong to a context — "general" everywhere, "list" while the
// library is shown, "pdf" while a PDF is open — so one key can do one
// thing in the list and another in the viewer. Single keys never fire
// while text is being typed (dispatch.ts).
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShortcutContext = "general" | "list" | "pdf";

export interface ShortcutAction {
  id: string;
  label: string;
  context: ShortcutContext;
  defaults: string[];
}

export const CONTEXT_LABELS: Record<ShortcutContext, string> = {
  general: "General",
  list: "Library (an item selected)",
  pdf: "PDF viewer",
};

const a = (context: ShortcutContext, id: string, label: string, ...defaults: string[]): ShortcutAction => ({
  id,
  label,
  context,
  defaults,
});

export const ACTIONS: ShortcutAction[] = [
  a("general", "toggleLeft", "Toggle the left sidebar (the outline, while reading)", "mod+\\"),
  a("general", "toggleRight", "Toggle the right sidebar", "mod+shift+\\"),
  a("general", "focusSearch", "Focus the search field", "mod+f"),
  // The recent-PDFs menu's first five, in its order: the PDFs opened
  // lately, newest first, leaving out the one open (lib/recent.ts).
  ...[1, 2, 3, 4, 5].map((n) => a("general", `recent${n}`, `Open recent PDF ${n}`, `mod+${n}`)),

  a("list", "listInfo", "Show details", "d"),
  a("list", "listHighlights", "Show highlights", "h"),
  a("list", "listNotes", "Show notes", "n"),
  a("list", "listChats", "Show AI conversations (with AI connected)", "q"),
  a("list", "listPdf", "View the PDF", "p"),
  a("list", "nextPane", "Next pane (sidebar, list, details)", "tab"),
  a("list", "prevPane", "Previous pane", "shift+tab"),
  a("list", "moveUp", "Move up", "arrowup"),
  a("list", "moveDown", "Move down", "arrowdown"),
  a("list", "moveLeft", "Move left (icon view; folds a folder in the sidebar)", "arrowleft"),
  a("list", "moveRight", "Move right (icon view; unfolds a folder in the sidebar)", "arrowright"),
  a("list", "extendUp", "Extend the selection up", "shift+arrowup"),
  a("list", "extendDown", "Extend the selection down", "shift+arrowdown"),
  a("list", "activate", "Select the folder / open the item", "enter"),

  a("pdf", "pdfInfo", "Show details", "d"),
  a("pdf", "pdfHighlights", "Show highlights", "h"),
  a("pdf", "pdfSearchHighlights", "Search the highlights", "mod+shift+f"),
  a("pdf", "pdfNotes", "Show notes", "n"),
  a("pdf", "pdfChats", "Show AI conversations (with AI connected)", "q"),
  a("pdf", "pdfThumbnails", "Thumbnail view", "g"),
  a("pdf", "pdfFolded", "Toggle the folded view", "f"),
  a("pdf", "pdfFoldFilters", "Folded view filters", "shift+f"),
  a("pdf", "pdfExpandFold", "Open / close the fold under the pointer", "e"),
  a("pdf", "pdfHorizontal", "Horizontal scroll", "z"),
  a("pdf", "pdfVertical", "Vertical scroll", "v"),
  a("pdf", "pdfFit1", "Fit one page", "1"),
  a("pdf", "pdfFit2", "Fit two pages", "2"),
  a("pdf", "pdfFit3", "Fit three pages", "3"),
  a("pdf", "pdfFixed", "Paged view", "p"),
  a("pdf", "pdfContinuous", "Continuous view", "c"),
  a("pdf", "pdfNext", "Next page (next fold, when folded)", "arrowright", "arrowdown"),
  a("pdf", "pdfPrev", "Previous page (previous fold, when folded)", "arrowleft", "arrowup"),
];

/** Shortcuts that are built in and not rebindable, listed in Settings
 *  so they can be found. */
export const FIXED_SHORTCUTS: { context: string; keys: string; label: string }[] = [
  { context: "PDF viewer", keys: "mod+=", label: "Zoom in" },
  { context: "PDF viewer", keys: "mod+-", label: "Zoom out" },
  { context: "PDF viewer", keys: "mod+0", label: "Back to the default layout" },
  { context: "PDF viewer", keys: "mod", label: "Hold in the paged view to trim the pages' edges" },
  { context: "PDF search", keys: "enter", label: "Next match (⇧ for the previous)" },
  { context: "Notes", keys: "mod+i", label: "Italic" },
  { context: "Notes", keys: "mod+b", label: "Bold" },
  { context: "Notes", keys: "mod+=", label: "Highlight" },
  { context: "Notes", keys: "mod+k", label: "Link" },
  { context: "Notes", keys: "?", label: "At the start of a line: the reading questions" },
];

export const APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

interface ShortcutStore {
  /** Actions rebound here, by id — absent ones keep their defaults. An
   *  empty list switches the action off. */
  custom: Record<string, string[]>;
  setBindings: (id: string, combos: string[]) => void;
  resetAll: () => void;
}

export const useShortcuts = create<ShortcutStore>()(
  persist(
    (set) => ({
      custom: {},
      setBindings: (id, combos) =>
        set((s) => {
          const custom = { ...s.custom };
          const action = ACTIONS.find((x) => x.id === id);
          if (action && combos.join() === action.defaults.join()) delete custom[id];
          else custom[id] = combos;
          return { custom };
        }),
      resetAll: () => set({ custom: {} }),
    }),
    { name: "zotero-helper-shortcuts" },
  ),
);

export function bindingsOf(id: string, custom = useShortcuts.getState().custom): string[] {
  return custom[id] ?? ACTIONS.find((x) => x.id === id)?.defaults ?? [];
}

/** Do actions in these two contexts ever listen at the same time? */
export const contextsOverlap = (x: ShortcutContext, y: ShortcutContext) =>
  x === y || x === "general" || y === "general";

/** The other actions bound to `combo` that would be live alongside
 *  `id` — two actions on one key in one place is a conflict. */
export function conflictsWith(id: string, combo: string, custom = useShortcuts.getState().custom): ShortcutAction[] {
  const self = ACTIONS.find((x) => x.id === id);
  if (!self) return [];
  return ACTIONS.filter(
    (x) => x.id !== id && contextsOverlap(x.context, self.context) && bindingsOf(x.id, custom).includes(combo),
  );
}

const CODE_KEYS: Record<string, string> = {
  Backslash: "\\", Slash: "/", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=",
  Comma: ",", Period: ".", Semicolon: ";", Quote: "'", Backquote: "`", IntlBackslash: "\\",
};
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "OS"]);

/** The combo a keydown is, or null for a bare modifier. Letters go by
 *  what they type (so a French keyboard's A is "a"); digits and
 *  punctuation by the key itself, since ⇧ and ⌥ change what they type. */
export function eventCombo(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key: string;
  if (/^[a-z]$/i.test(e.key)) key = e.key.toLowerCase();
  else {
    const m = /^(?:Key([A-Z])|Digit(\d)|Numpad(\d))$/.exec(e.code);
    if (m) key = (m[1] ?? m[2] ?? m[3]).toLowerCase();
    else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code];
    else if (e.key === " ") key = "space";
    else key = e.key.toLowerCase();
  }
  const mods: string[] = [];
  if (APPLE ? e.metaKey : e.ctrlKey) mods.push("mod");
  if (APPLE && e.ctrlKey) mods.push("ctrl");
  if (!APPLE && e.metaKey) mods.push("meta");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  return [...mods, key].join("+");
}

/** Does the combo hold a modifier other than ⇧ — one that can't be
 *  mistaken for typing? */
export const hasCommandModifier = (combo: string) => /(^|\+)(mod|ctrl|alt|meta)\+/.test(combo);

const KEY_GLYPHS: Record<string, string> = {
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
  enter: APPLE ? "↩" : "Enter", tab: APPLE ? "⇥" : "Tab", space: "Space",
  escape: "Esc", backspace: APPLE ? "⌫" : "Backspace", delete: "Del",
};
const MOD_GLYPHS: Record<string, string> = APPLE
  ? { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧", meta: "Meta" }
  : { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Win" };

/** "mod+shift+\\" → "⌘⇧\" on a Mac, "Ctrl+Shift+\" elsewhere. */
export function formatCombo(combo: string): string {
  const parts = combo === "+" ? ["+"] : combo.split("+").map((p, i, all) => (p === "" && i === all.length - 1 ? "+" : p));
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1).filter(Boolean);
  // A combo that is only modifiers ("mod"), as the fixed list has.
  if (MOD_GLYPHS[key] && !mods.length) return MOD_GLYPHS[key];
  const keyLabel = KEY_GLYPHS[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
  const modLabels = mods.map((m) => MOD_GLYPHS[m] ?? m);
  return APPLE ? modLabels.join("") + keyLabel : [...modLabels, keyLabel].join("+");
}

/** " (⌘\)" — the action's first binding, for a button's tooltip. */
export function shortcutHint(id: string): string {
  const first = bindingsOf(id)[0];
  return first ? ` (${formatCombo(first)})` : "";
}
