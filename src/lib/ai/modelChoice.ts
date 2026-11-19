// Which model each AI task uses, and the models each provider offers.
//
// Both providers' keys can be in at once (Settings → AI), and each task
// has a model of its own from either: `Settings.aiModels`, task →
// "service:model". The Rust core resolves the same map the same way
// (src-tauri/src/ai/mod.rs, `Provider::resolve`): a task with nothing
// there uses the one provider and model chosen before tasks had their
// own, so settings saved then keep working until saved again.
//
// What there is to choose from is the price table (models.ts) and each
// provider's own list of what it offers now (`ai_list_models`, which asks
// its /v1/models), kept on this device (`zotero-helper-ai-listed`) and
// asked again from Settings → AI — by itself when the list is a week old.
import { create } from "zustand";
import { invoke } from "../tauri";
import type { AiService, Settings } from "../types";
import { setListedLabels } from "./models";

export type AiTask = "chat" | "explain" | "define" | "metadata" | "title";

export const AI_TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: "chat", label: "Questions", hint: "Conversations about abstracts and papers, and their clarifications" },
  { id: "explain", label: "Explainer", hint: "A passage explained, in the reader" },
  { id: "define", label: "Look-up", hint: "A word or phrase defined, in the reader" },
  { id: "metadata", label: "Tidy Metadata & Get Abstract", hint: "Cleaning up entries, lifting abstracts out of PDFs" },
  { id: "title", label: "Titles", hint: "Naming conversations and explanations — a small job" },
];

export const AI_SERVICES: { id: AiService; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
];

/** A model as chosen: its provider and id. */
export interface ModelRef {
  service: AiService;
  id: string;
}

export const refString = (r: ModelRef): string => `${r.service}:${r.id}`;

export function parseRef(s: string | undefined): ModelRef | null {
  const at = s?.indexOf(":") ?? -1;
  if (!s || at < 1) return null;
  const id = s.slice(at + 1).trim();
  return id ? { service: s.slice(0, at) === "openai" ? "openai" : "anthropic", id } : null;
}

/** The model `task` uses under settings `s` (as the Rust core resolves
 *  it). */
export function taskModel(s: Settings, task: AiTask): ModelRef {
  const chosen = parseRef(s.aiModels?.[task]);
  if (chosen) return chosen;
  return s.aiService === "openai" ? { service: "openai", id: s.openaiModel } : { service: "anthropic", id: s.anthropicModel };
}

export const keyOf = (s: Settings, service: AiService): string =>
  (service === "openai" ? s.openaiApiKey : s.anthropicApiKey)?.trim() ?? "";

/** A sensible model for each task from each provider: the balanced tier
 *  for reading, the cheapest for the small jobs. */
const SUGGESTED: Record<AiService, Record<AiTask, string>> = {
  anthropic: { chat: "claude-sonnet-5-5", explain: "claude-sonnet-5-5", define: "claude-haiku-5-5", metadata: "claude-sonnet-5-5", title: "claude-haiku-5-5" },
  openai: { chat: "gpt-6.1-terra", explain: "gpt-6.1-terra", define: "gpt-6-luna", metadata: "gpt-6.1-terra", title: "gpt-6-luna" },
};

/** The model Settings → AI shows for `task` in a draft of the settings
 *  (and saves): the one chosen, or the one of before — unless that one's
 *  provider has no key and the other has, when it is the other's
 *  suggestion for the task. */
export function draftTaskModel(s: Settings, task: AiTask): ModelRef {
  const ref = taskModel(s, task);
  if (parseRef(s.aiModels?.[task]) || keyOf(s, ref.service)) return ref;
  const other: AiService = ref.service === "openai" ? "anthropic" : "openai";
  return keyOf(s, other) ? { service: other, id: SUGGESTED[other][task] } : ref;
}

// --- what each provider offers now ------------------------------------------

/** A model as its provider lists it (src-tauri/src/ai/models.rs). */
export interface ListedModel {
  id: string;
  label: string;
  /** "YYYY-MM-DD", or empty. */
  released: string;
}

interface Listing {
  models: ListedModel[];
  /** When it was asked, ms. */
  at: number;
}

interface ListedState {
  lists: Partial<Record<AiService, Listing>>;
  /** Asking now. */
  busy: Partial<Record<AiService, boolean>>;
  /** Why the last asking failed. */
  errors: Partial<Record<AiService, string>>;
}

const STORE_KEY = "zotero-helper-ai-listed";
/** A list this old is asked again as Settings → AI opens. */
export const LIST_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function loadLists(): ListedState["lists"] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as ListedState["lists"];
  } catch {
    return {};
  }
}

export const useListedModels = create<ListedState>(() => ({ lists: loadLists(), busy: {}, errors: {} }));

setListedLabels((id) => {
  const { lists } = useListedModels.getState();
  for (const l of Object.values(lists)) {
    const m = l?.models.find((x) => x.id === id);
    if (m) return m.label;
  }
  return undefined;
});

/** Ask `service` for the models it offers `apiKey` (the key being typed
 *  in, before it is saved), and keep the answer. */
export async function refreshListedModels(service: AiService, apiKey: string): Promise<void> {
  const set = useListedModels.setState;
  set((st) => ({ busy: { ...st.busy, [service]: true }, errors: { ...st.errors, [service]: undefined } }));
  try {
    const models = await invoke<ListedModel[]>("ai_list_models", { service, apiKey });
    set((st) => {
      const lists = { ...st.lists, [service]: { models, at: Date.now() } };
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(lists));
      } catch {
        /* storage unavailable: the list lasts this session */
      }
      return { lists };
    });
  } catch (e) {
    set((st) => ({ errors: { ...st.errors, [service]: String(e) } }));
  } finally {
    set((st) => ({ busy: { ...st.busy, [service]: false } }));
  }
}
