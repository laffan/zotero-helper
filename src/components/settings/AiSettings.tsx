// Settings → AI: both providers' keys (either, or both), then the model
// each task uses — from either provider with a key — chosen from what
// each provider lists as available now (asked again with Refresh, and by
// itself when the list is a week old) and from the app's price table
// (lib/ai/models.ts), with each model's price where the table has it.
// Keys and models are a draft, which SettingsView saves; the reader's
// prompts (PromptSettings.tsx) apply at once.
import { useEffect } from "react";
import { findModel, modelLabel, modelsFor } from "../../lib/ai/models";
import {
  AI_SERVICES, AI_TASKS, draftTaskModel, keyOf, LIST_STALE_MS, parseRef, refreshListedModels, refString,
  useListedModels, type AiTask, type ListedModel, type ModelRef,
} from "../../lib/ai/modelChoice";
import type { AiService } from "../../lib/types";
import { PromptSettings } from "./PromptSettings";
import type { DraftProps } from "./SettingsView";

/** "$2 in · $10 out per million tokens", or that the price isn't known. */
function priceOf(id: string): string {
  const m = findModel(id);
  if (!m) return "price not in the app's table — its costs show as $0";
  return `$${m.inputPerMTok} in · $${m.outputPerMTok} out per million tokens`;
}

interface Choice {
  ref: string;
  text: string;
}

/** A provider's models to choose from: its own list where it has given
 *  one (newest first) — else the price table's — each with its price. */
function choicesFor(service: AiService, listed: ListedModel[] | undefined): Choice[] {
  const name = (id: string, label: string) => {
    const m = findModel(id);
    return m ? `${label} — $${m.inputPerMTok} / $${m.outputPerMTok}` : `${label} — price unknown`;
  };
  if (listed?.length) return listed.map((m) => ({ ref: refString({ service, id: m.id }), text: name(m.id, m.label) }));
  return modelsFor(service).map((m) => ({ ref: refString({ service, id: m.id }), text: name(m.id, m.label) }));
}

export function AiSettings({ draft, setDraft }: DraftProps) {
  const { lists, busy, errors } = useListedModels();
  const keyed = AI_SERVICES.filter((s) => keyOf(draft, s.id));

  // A list a week old (or none) is asked again as the section opens.
  useEffect(() => {
    for (const s of AI_SERVICES) {
      const key = keyOf(draft, s.id);
      const list = useListedModels.getState().lists[s.id];
      if (key && (!list || Date.now() - list.at > LIST_STALE_MS)) void refreshListedModels(s.id, key);
    }
    // Once, as the section opens; Refresh asks again.
  }, []);

  const setKey = (service: AiService, v: string) =>
    setDraft((d) => (service === "openai" ? { ...d, openaiApiKey: v } : { ...d, anthropicApiKey: v }));
  const setModel = (tasks: AiTask[], ref: string) =>
    setDraft((d) => ({ ...d, aiModels: { ...d.aiModels, ...Object.fromEntries(tasks.map((t) => [t, ref])) } }));
  const refresh = () => {
    for (const s of keyed) void refreshListedModels(s.id, keyOf(draft, s.id));
  };

  const groups = keyed.map((s) => ({ ...s, choices: choicesFor(s.id, lists[s.id]?.models) }));

  /** The dropdown for a model: every keyed provider's models, and the one
   *  chosen even if its provider has no key or doesn't list it. */
  const picker = (value: ModelRef | null, onPick: (ref: string) => void, label: string) => {
    const current = value ? refString(value) : "";
    const known = groups.some((g) => g.choices.some((c) => c.ref === current));
    return (
      <select value={current} onChange={(e) => e.target.value && onPick(e.target.value)} aria-label={label}>
        {!value && <option value="">Choose…</option>}
        {value && !known && (
          <option value={current}>
            {modelLabel(value.id)} ({value.service === "openai" ? "OpenAI" : "Anthropic"}
            {keyOf(draft, value.service) ? ", not listed" : ", no key"})
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.id} label={g.label}>
            {g.choices.map((c) => (
              <option key={c.ref} value={c.ref}>
                {c.text}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    );
  };

  const listedNote = (service: AiService) => {
    if (!keyOf(draft, service)) return "No key";
    if (busy[service]) return "Listing its models…";
    if (errors[service]) return errors[service];
    const l = lists[service];
    if (!l) return "Its models not listed yet";
    return `${l.models.length} models listed ${new Date(l.at).toLocaleDateString()}`;
  };

  return (
    <>
      <p className="hint">
        Used by Tidy Metadata, Get Abstract, the Questions conversations, and the reader's explainer and look-up.
        Optional — everything else works without it. Either key will do, or both.
      </p>

      <h4 className="settings-subhead">Keys</h4>
      <div className="settings-row">
        {AI_SERVICES.map((s) => (
          <label key={s.id} className="settings-field">
            <span>{s.label} API key</span>
            <input
              type="password"
              value={s.id === "openai" ? draft.openaiApiKey : draft.anthropicApiKey}
              onChange={(e) => setKey(s.id, e.target.value)}
              autoComplete="off"
            />
            <small className={`ai-key-note ${errors[s.id] ? "bad" : ""}`}>{listedNote(s.id)}</small>
          </label>
        ))}
      </div>

      <div className="ai-models-head">
        <h4 className="settings-subhead">Models</h4>
        <button
          type="button"
          className="mini-btn"
          onClick={refresh}
          disabled={!keyed.length || keyed.some((s) => busy[s.id])}
          title="Ask each provider for the models it offers now"
        >
          Refresh model lists
        </button>
      </div>
      {!keyed.length ? (
        <p className="hint">Add a key above to choose the models.</p>
      ) : (
        <div className="ai-task-list">
          <div className="ai-task ai-task-all">
            <div className="ai-task-name">
              <strong>Every task</strong>
              <span>Set them all at once</span>
            </div>
            {picker(null, (ref) => setModel(AI_TASKS.map((t) => t.id), ref), "Model for every task")}
          </div>
          {AI_TASKS.map((t) => {
            const chosen = draftTaskModel(draft, t.id);
            const noKey = !keyOf(draft, chosen.service);
            return (
              <div key={t.id} className="ai-task">
                <div className="ai-task-name">
                  <strong>{t.label}</strong>
                  <span>{t.hint}</span>
                </div>
                <div className="ai-task-pick">
                  {picker(chosen, (ref) => parseRef(ref) && setModel([t.id], ref), `Model for ${t.label}`)}
                  <small className={noKey ? "bad" : ""}>
                    {noKey
                      ? `No ${chosen.service === "openai" ? "OpenAI" : "Anthropic"} key — add one, or pick another model`
                      : `${findModel(chosen.id)?.blurb ? `${findModel(chosen.id)!.blurb} · ` : ""}${priceOf(chosen.id)}`}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <PromptSettings />
    </>
  );
}
