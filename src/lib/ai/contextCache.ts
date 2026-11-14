// Which explainer contexts the provider still holds in its prompt cache:
// what lets the In Context menu (ExplainContextMenu.tsx) say that a part
// of a PDF has already been sent, and how much longer it stays cached.
//
// An explainer's context is the work's metadata and the text of the part
// chosen — nothing about the passage (its page goes with the question,
// chat.ts) — so every explainer of one PDF asked with the same part sends
// the same bytes, and the provider serves them from its cache for the
// window CACHE_TTL_MS gives, every use starting it again. A part counts
// as cached only when the reply says so: a cache written or read
// (Anthropic reports both; OpenAI only reads, and caches by itself any
// prompt of 1024 tokens or more). Kept on this device, a few entries at
// most, the expired dropped as it is written.
import type { AiService, ChatUsage, ContextPart } from "../types";
import { CACHE_TTL_MS } from "./models";

const KEY = "zh-context-cache";

interface Sent {
  model: string;
  service: AiService;
  ms: number;
}

function load(): Record<string, Sent> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, Sent>;
  } catch {
    return {};
  }
}

const ttl = (s: Sent) => CACHE_TTL_MS[s.service] ?? 0;

/** One part of one PDF, as the cache knows it. */
export const partKey = (p: ContextPart) => `${p.attKey}|${p.kind}|${p.from}-${p.to}|${p.label}`;

/** A reply to an explainer asked with `part`: cached until the window
 *  closes, if the reply says it was cached. */
export function noteSent(part: ContextPart, service: AiService, model: string, usage: ChatUsage): void {
  const cached =
    usage.cacheWriteTokens > 0 || usage.cachedInputTokens > 0 || (service === "openai" && usage.inputTokens >= 1024);
  const all = load();
  const now = Date.now();
  for (const [k, s] of Object.entries(all)) if (now >= s.ms + ttl(s)) delete all[k];
  if (cached) all[partKey(part)] = { model, service, ms: now };
  else delete all[partKey(part)];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the menu just won't say */
  }
}

/** How much longer `part` stays cached for `model`, ms; 0 if it isn't. */
export function cachedFor(part: ContextPart, model: string): number {
  const s = load()[partKey(part)];
  if (!s || s.model !== model) return 0;
  return Math.max(0, s.ms + ttl(s) - Date.now());
}
