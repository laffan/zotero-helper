// The prompts the reader's AI features ask with, as the reader has
// written them (Settings → AI → Prompts): the explainer's first question
// and the look-up's. Each is a template — text with tokens in it,
// `{selection}` for the passage selected and `{title}`, `{authors}`,
// `{year}` for the work it was read in — filled in as it is sent. The
// system prompts around them (how long, in what form) stay the
// backend's (src-tauri/src/ai/chat.rs). Kept on this device.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PromptFeature = "explain" | "lookup";

export const PROMPT_FEATURES: { id: PromptFeature; label: string; hint: string }[] = [
  {
    id: "explain",
    label: "Explain",
    hint: "The explainer's first question (the sparkles over a selection). The window shows only the selection.",
  },
  {
    id: "lookup",
    label: "Look up",
    hint: "The look-up's question (the magnifier over a selection): a definition of at most 50 words, kept in Words.",
  },
];

export const PROMPT_TOKENS: { id: string; label: string }[] = [
  { id: "selection", label: "Selection" },
  { id: "title", label: "Title" },
  { id: "authors", label: "Authors" },
  { id: "year", label: "Year" },
];

export const DEFAULT_PROMPTS: Record<PromptFeature, string> = {
  explain: "What would the encyclopedia entry for “{selection}” be?",
  lookup: "Define “{selection}”",
};

interface PromptStore {
  prompts: Partial<Record<PromptFeature, string>>;
  setPrompt: (f: PromptFeature, text: string | null) => void;
}

export const usePrompts = create<PromptStore>()(
  persist(
    (set) => ({
      prompts: {},
      setPrompt: (f, text) =>
        set((s) => {
          const prompts = { ...s.prompts };
          if (text === null || text === DEFAULT_PROMPTS[f]) delete prompts[f];
          else prompts[f] = text;
          return { prompts };
        }),
    }),
    { name: "zotero-helper-prompts" },
  ),
);

/** The template a feature asks with now. */
export function promptTemplate(f: PromptFeature): string {
  return usePrompts.getState().prompts[f] ?? DEFAULT_PROMPTS[f];
}

/** A template with its tokens filled in (an unknown token is left as
 *  written; an empty value leaves nothing). */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, id: string) => (id in values ? values[id] : all)).trim();
}
