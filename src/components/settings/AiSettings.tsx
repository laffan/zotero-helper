// Settings → AI: the service, its key and the model every AI feature
// uses — a draft, which SettingsView saves — and the reader's prompts
// (PromptSettings.tsx), which apply at once.
import { AI_SERVICES, modelsFor } from "../../lib/ai/models";
import type { AiService } from "../../lib/types";
import { PromptSettings } from "./PromptSettings";
import type { DraftProps } from "./SettingsView";

export function AiSettings({ draft, set, setDraft }: DraftProps) {
  const service: AiService = draft.aiService === "openai" ? "openai" : "anthropic";
  const models = modelsFor(service);
  const isOpenAi = service === "openai";
  const keyField = isOpenAi ? "openaiApiKey" : "anthropicApiKey";
  const modelField = isOpenAi ? "openaiModel" : "anthropicModel";
  const chosenModel = isOpenAi ? draft.openaiModel : draft.anthropicModel;
  const model = models.find((m) => m.id === chosenModel);

  /** Switching service keeps a model that belongs to it; a stale id
   *  from the other provider falls back to that service's first. */
  const pickService = (next: AiService) => {
    setDraft((d) => {
      const ids = modelsFor(next).map((m) => m.id);
      const current = next === "openai" ? d.openaiModel : d.anthropicModel;
      const id = ids.includes(current) ? current : ids[0];
      return next === "openai"
        ? { ...d, aiService: next, openaiModel: id }
        : { ...d, aiService: next, anthropicModel: id };
    });
  };

  return (
    <>
      <p className="hint">
        Used by Tidy Metadata, Get Abstract, the Questions conversations,
        and the reader's explainer and look-up. Optional — everything else
        works without it.
      </p>
      <label className="settings-field">
        <span>Service</span>
        <select value={service} onChange={(e) => pickService(e.target.value as AiService)}>
          {AI_SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settings-row">
        <label className="settings-field">
          <span>{isOpenAi ? "OpenAI" : "Anthropic"} API key</span>
          <input
            type="password"
            value={draft[keyField]}
            onChange={(e) => set(keyField, e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="settings-field">
          <span>Model</span>
          <select value={chosenModel} onChange={(e) => set(modelField, e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {model && (
        <p className="hint">
          {model.blurb} — ${model.inputPerMTok}/M in, ${model.outputPerMTok}/M out.
        </p>
      )}
      <PromptSettings />
    </>
  );
}
