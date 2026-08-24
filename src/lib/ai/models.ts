// The models the app will talk to, and what they cost.
//
// Deliberately a short fixed list rather than whatever the provider's
// /models endpoint returns: the app's AI work is metadata cleanup and
// reading conversations, and these are the two tiers per provider worth
// pointing at it — a cheap one for volume, a stronger one for judgement.
//
// Prices are USD per million tokens, from each provider's public rate
// card. They move; when they do, this table is the only place to edit.
import type { AiService, ChatUsage } from "../types";

export interface AiModel {
  id: string;
  label: string;
  service: AiService;
  /** Uncached input, per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Input served from the provider's prompt cache. */
  cachedInputPerMTok: number;
  /** Writing the cache, where the provider bills for it separately. */
  cacheWritePerMTok: number;
  /** Above this many input tokens the provider switches to its
   *  long-context rates (0 when it has none). */
  longContextFrom: number;
  longInputPerMTok: number;
  longOutputPerMTok: number;
  contextTokens: number;
  /** Rough words the model can hold, for the human-readable hint. */
  blurb: string;
}

export const AI_MODELS: AiModel[] = [
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    service: "anthropic",
    inputPerMTok: 3,
    outputPerMTok: 15,
    cachedInputPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    longContextFrom: 0,
    longInputPerMTok: 3,
    longOutputPerMTok: 15,
    contextTokens: 1_000_000,
    blurb: "Strongest reading of the papers",
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    service: "anthropic",
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    longContextFrom: 0,
    longInputPerMTok: 1,
    longOutputPerMTok: 5,
    contextTokens: 200_000,
    blurb: "Fast and cheap; 200K context",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    service: "openai",
    inputPerMTok: 2,
    outputPerMTok: 12,
    cachedInputPerMTok: 0.2,
    // OpenAI does not bill cache writes separately.
    cacheWritePerMTok: 0,
    longContextFrom: 272_000,
    longInputPerMTok: 4,
    longOutputPerMTok: 18,
    contextTokens: 1_050_000,
    blurb: "The balanced everyday tier",
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    service: "openai",
    inputPerMTok: 0.2,
    outputPerMTok: 1.2,
    cachedInputPerMTok: 0.02,
    cacheWritePerMTok: 0,
    longContextFrom: 272_000,
    longInputPerMTok: 0.4,
    longOutputPerMTok: 1.8,
    contextTokens: 1_050_000,
    blurb: "Cheapest by a wide margin",
  },
];

export const AI_SERVICES: { id: AiService; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI" },
];

/** How long a provider keeps a cached prompt prefix alive. The chat
 *  panel counts this down so it's obvious when the next question is
 *  about to re-read the papers at full price. */
export const CACHE_TTL_MS: Record<AiService, number> = {
  anthropic: 5 * 60 * 1000,
  openai: 30 * 60 * 1000,
};

export function modelsFor(service: AiService): AiModel[] {
  return AI_MODELS.filter((m) => m.service === service);
}

/** The catalog entry for an id, or undefined for a model that's been
 *  retired out of the list since a chat used it. */
export function findModel(id: string): AiModel | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

export function modelLabel(id: string): string {
  return findModel(id)?.label ?? id;
}

/** Rates in effect for a request of this size — the long-context tier
 *  kicks in as a cliff, not a gradient. */
function ratesAt(model: AiModel, inputTokens: number) {
  const long =
    model.longContextFrom > 0 && inputTokens > model.longContextFrom;
  return {
    input: long ? model.longInputPerMTok : model.inputPerMTok,
    output: long ? model.longOutputPerMTok : model.outputPerMTok,
  };
}

/** USD for one call, given what the provider says it billed. */
export function usageCost(modelId: string, usage: ChatUsage): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const total =
    usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
  const { input, output } = ratesAt(model, total);
  return (
    (usage.inputTokens * input +
      usage.cachedInputTokens * model.cachedInputPerMTok +
      usage.cacheWriteTokens * model.cacheWritePerMTok +
      usage.outputTokens * output) /
    1_000_000
  );
}

/** What a reply of `outputTokens` on top of `inputTokens` of fresh
 *  input would cost. Used for the popup, before anything is sent. */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const { input, output } = ratesAt(model, inputTokens);
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

/** What the same question costs once the papers are cached — the number
 *  that makes a long conversation affordable. */
export function cachedFollowUpCost(
  modelId: string,
  contextTokens: number,
  outputTokens: number,
): number {
  const model = findModel(modelId);
  if (!model) return 0;
  const { output } = ratesAt(model, contextTokens);
  return (
    (contextTokens * model.cachedInputPerMTok + outputTokens * output) /
    1_000_000
  );
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
