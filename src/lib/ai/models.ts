// The models the app knows the prices of, and what they cost.
//
// Which model each AI task uses is chosen in Settings → AI
// (modelChoice.ts), from these and from whatever each provider lists as
// available now — a model released since this table was written can be
// picked the day it appears, its cost then shown as unknown until it is
// added here.
//
// Prices are USD per million tokens, from each provider's own pricing
// page (Anthropic's and OpenAI's, as of November 2026). They move; when
// they do, this table is the only place to edit. A long-context tier,
// where a provider has one, is a cliff on the whole request: past
// `longContextFrom` input tokens every token of it is billed at the long
// rates.
import type { AiService, ChatUsage, Settings } from "../types";

export interface AiModel {
  id: string;
  label: string;
  service: AiService;
  /** Uncached input, per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Input served from the provider's prompt cache. */
  cachedInputPerMTok: number;
  /** Writing the cache (Anthropic's 5-minute, OpenAI's 30-minute). */
  cacheWritePerMTok: number;
  /** Above this many input tokens the provider switches to its
   *  long-context rates (0 when it has none). */
  longContextFrom: number;
  longInputPerMTok: number;
  longOutputPerMTok: number;
  longCachedInputPerMTok: number;
  longCacheWritePerMTok: number;
  contextTokens: number;
  /** What it is good for, in a few words. */
  blurb: string;
}

type Rates = [input: number, cached: number, write: number, output: number];

/** A model with no long-context tier. */
function flat(id: string, label: string, service: AiService, [i, c, w, o]: Rates, contextTokens: number, blurb: string): AiModel {
  return {
    id, label, service, inputPerMTok: i, cachedInputPerMTok: c, cacheWritePerMTok: w, outputPerMTok: o,
    longContextFrom: 0, longInputPerMTok: i, longOutputPerMTok: o, longCachedInputPerMTok: c, longCacheWritePerMTok: w,
    contextTokens, blurb,
  };
}

/** OpenAI's current models: past 272K input tokens, input and cache
 *  rates double and output costs 1.5 times as much. */
function openai(id: string, label: string, rates: Rates, blurb: string): AiModel {
  const [i, c, w, o] = rates;
  return {
    ...flat(id, label, "openai", rates, 1_050_000, blurb),
    longContextFrom: 272_000, longInputPerMTok: i * 2, longCachedInputPerMTok: c * 2, longCacheWritePerMTok: w * 2, longOutputPerMTok: o * 1.5,
  };
}

/** Newest first within each provider; the dropdowns keep this order
 *  where the provider's own list doesn't say. */
export const AI_MODELS: AiModel[] = [
  flat("claude-fable-5-2", "Claude Fable 5.2", "anthropic", [8, 0.2, 10, 40], 1_000_000, "The most capable; for the hardest reading"),
  flat("claude-opus-5-5", "Claude Opus 5.5", "anthropic", [4, 0.2, 5, 20], 1_000_000, "Strong, careful reading of papers"),
  flat("claude-sonnet-5-5", "Claude Sonnet 5.5", "anthropic", [2, 0.1, 2.5, 10], 1_000_000, "Speed and judgement balanced"),
  {
    // Priced by prompt length: over 100,000 input tokens, five times.
    ...flat("claude-haiku-5-5", "Claude Haiku 5.5", "anthropic", [0.1, 0.01, 0.125, 0.5], 1_000_000, "Fast and cheapest; quick look-ups"),
    longContextFrom: 100_000, longInputPerMTok: 0.5, longCachedInputPerMTok: 0.05, longCacheWritePerMTok: 0.625, longOutputPerMTok: 2.5,
  },
  flat("claude-sonnet-5", "Claude Sonnet 5", "anthropic", [2, 0.2, 2.5, 10], 1_000_000, "The previous Sonnet"),
  flat("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic", [1, 0.1, 1.25, 5], 200_000, "The previous Haiku; 200K context"),
  openai("gpt-6.2-astra", "GPT-6.2 Astra", [8, 0.4, 10, 40], "OpenAI's most capable"),
  openai("gpt-6.2-sol", "GPT-6.2 Sol", [2, 0.1, 2.5, 10], "Speed and judgement balanced"),
  openai("gpt-6.1-terra", "GPT-6.1 Terra", [1, 0.05, 1.25, 5], "The everyday tier"),
  openai("gpt-6-luna", "GPT-6 Luna", [0.1, 0.01, 0.125, 0.5], "Cheapest by a wide margin"),
  openai("gpt-6-astra", "GPT-6 Astra", [10, 1, 12.5, 50], "The previous Astra"),
  openai("gpt-6.1-sol", "GPT-6.1 Sol", [2, 0.1, 2.5, 10], "The previous Sol"),
  openai("gpt-5.6-terra", "GPT-5.6 Terra", [2, 0.2, 2.5, 12], "The previous Terra"),
  openai("gpt-5.6-luna", "GPT-5.6 Luna", [0.2, 0.02, 0.25, 1.2], "The previous Luna"),
];

/** How long a provider keeps a cached prompt prefix alive. The chat
 *  panel counts this down so it's obvious when the next question is
 *  about to re-read the papers at full price. */
export const CACHE_TTL_MS: Record<AiService, number> = {
  anthropic: 5 * 60 * 1000,
  openai: 30 * 60 * 1000,
};

/** Is an AI service connected — a key in for either provider? The AI
 *  features (the toolbar's AI menu, Questions in the sidebar) are only
 *  shown when one is; Settings → AI is where they get connected, and
 *  which model each task uses is chosen there (modelChoice.ts). */
export function aiConnected(s: Settings | null): boolean {
  return Boolean(s && (s.anthropicApiKey?.trim() || s.openaiApiKey?.trim()));
}

export function modelsFor(service: AiService): AiModel[] {
  return AI_MODELS.filter((m) => m.service === service);
}

/** The catalog entry for an id — or for a dated snapshot of one
 *  ("…-20261101") — or undefined for a model the table doesn't know (one
 *  listed by its provider since, or retired out of it). */
export function findModel(id: string): AiModel | undefined {
  return AI_MODELS.find((m) => m.id === id || (id.startsWith(`${m.id}-`) && /^\d{6,8}$/.test(id.slice(m.id.length + 1))));
}

/** A model's name: the table's, or else as its provider lists it
 *  (`listedLabel`, modelChoice.ts registers it), or else its id. */
export function modelLabel(id: string): string {
  return findModel(id)?.label ?? listedLabel(id) ?? id;
}

let listedLabel: (id: string) => string | undefined = () => undefined;
/** Where modelLabel finds the names of models the table doesn't know. */
export function setListedLabels(fn: (id: string) => string | undefined): void {
  listedLabel = fn;
}

/** Rates in effect for a request of this size — the long-context tier
 *  kicks in as a cliff, not a gradient. */
function ratesAt(model: AiModel, inputTokens: number) {
  const long = model.longContextFrom > 0 && inputTokens > model.longContextFrom;
  return long
    ? { input: model.longInputPerMTok, output: model.longOutputPerMTok, cached: model.longCachedInputPerMTok, write: model.longCacheWritePerMTok }
    : { input: model.inputPerMTok, output: model.outputPerMTok, cached: model.cachedInputPerMTok, write: model.cacheWritePerMTok };
}

/** USD for one call, given what the provider says it billed (0 for a
 *  model whose prices the table doesn't have). */
export function usageCost(modelId: string, usage: ChatUsage): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const total = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  const r = ratesAt(model, total);
  return (
    (usage.inputTokens * r.input +
      usage.cachedInputTokens * r.cached +
      usage.cacheWriteTokens * r.write +
      usage.outputTokens * r.output) /
    1_000_000
  );
}

/** What a reply of `outputTokens` on top of `inputTokens` of fresh
 *  input would cost. Used for the popup, before anything is sent. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const r = ratesAt(model, inputTokens);
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

/** What the same question costs once the papers are cached — the number
 *  that makes a long conversation affordable. */
export function cachedFollowUpCost(modelId: string, contextTokens: number, outputTokens: number): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const r = ratesAt(model, contextTokens);
  return (contextTokens * r.cached + outputTokens * r.output) / 1_000_000;
}

/** A typical answer, for the estimates above. Chat replies here run a
 *  few hundred words; 800 tokens is a generous round number. */
export const TYPICAL_REPLY_TOKENS = 800;

/** Money, at a precision that stays honest at both ends: fractions of a
 *  cent matter for Luna, dollars for a full-paper Sonnet chat. */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
