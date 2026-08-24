import { useEffect, useState } from "react";
import { bootstrap, saveSettings, syncNow, verifyKey } from "../lib/actions";
import { AI_SERVICES, modelsFor } from "../lib/ai/models";
import { appLog, useStore } from "../lib/store";
import type { AiService, Settings } from "../lib/types";
import { Spinner } from "./Icons";

const BLANK: Settings = {
  zoteroApiKey: "",
  zoteroUserId: "",
  libraryType: "user",
  contactEmail: "",
  aiService: "anthropic",
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
  openaiApiKey: "",
  openaiModel: "gpt-5.6-terra",
  rateLimitMs: 1500,
};

export function SettingsView() {
  const stored = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const [draft, setDraft] = useState<Settings>(stored ?? BLANK);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const service: AiService =
    draft.aiService === "openai" ? "openai" : "anthropic";
  const models = modelsFor(service);
  const isOpenAi = service === "openai";
  const keyField = isOpenAi ? "openaiApiKey" : "anthropicApiKey";
  const modelField = isOpenAi ? "openaiModel" : "anthropicModel";
  const chosenModel = isOpenAi ? draft.openaiModel : draft.anthropicModel;

  /** Switching service keeps a model that belongs to it; a stale id
   *  from the other provider falls back to that service's first. */
  const pickService = (next: AiService) => {
    setDraft((d) => {
      const ids = modelsFor(next).map((m) => m.id);
      const current = next === "openai" ? d.openaiModel : d.anthropicModel;
      const model = ids.includes(current) ? current : ids[0];
      return next === "openai"
        ? { ...d, aiService: next, openaiModel: model }
        : { ...d, aiService: next, anthropicModel: model };
    });
  };

  const doVerify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const res = await verifyKey(draft.zoteroApiKey.trim());
      const userId = res.userID != null ? String(res.userID) : "";
      if (userId) set("zoteroUserId", userId);
      setVerifyMsg(
        `✓ Key valid — ${res.username ?? "user"} (ID ${userId || "unknown"})`,
      );
    } catch (e) {
      setVerifyMsg(`✗ ${e}`);
    } finally {
      setVerifying(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const clean: Settings = {
        ...draft,
        zoteroApiKey: draft.zoteroApiKey.trim(),
        zoteroUserId: draft.zoteroUserId.trim(),
        contactEmail: draft.contactEmail.trim(),
        anthropicApiKey: draft.anthropicApiKey.trim(),
        openaiApiKey: draft.openaiApiKey.trim(),
        rateLimitMs: Math.max(250, Number(draft.rateLimitMs) || 1500),
      };
      await saveSettings(clean);
      appLog("info", "Settings saved");
      setView("main");
      const lib = useStore.getState().library;
      if (lib.version === 0 && clean.zoteroApiKey && clean.zoteroUserId) {
        await bootstrap();
        await syncNow(true);
      }
    } catch (e) {
      appLog("error", `Saving settings failed: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-card">
        <h1>Settings</h1>

        <h2>Zotero</h2>
        <p className="hint">
          Create a key at{" "}
          <code>zotero.org &gt; Settings &gt; Security &gt; API Keys</code> with
          library read/write and file access.
        </p>
        <label className="settings-field">
          <span>API key</span>
          <div className="field-with-btn">
            <input
              type="password"
              value={draft.zoteroApiKey}
              onChange={(e) => set("zoteroApiKey", e.target.value)}
              autoComplete="off"
            />
            <button
              className="mini-btn"
              onClick={doVerify}
              disabled={!draft.zoteroApiKey.trim() || verifying}
            >
              {verifying ? <Spinner size={12} /> : "Verify"}
            </button>
          </div>
        </label>
        {verifyMsg && <div className="verify-msg">{verifyMsg}</div>}
        <div className="settings-row">
          <label className="settings-field">
            <span>User / Group ID</span>
            <input
              value={draft.zoteroUserId}
              onChange={(e) => set("zoteroUserId", e.target.value)}
              placeholder="filled by Verify"
            />
          </label>
          <label className="settings-field">
            <span>Library type</span>
            <select
              value={draft.libraryType}
              onChange={(e) =>
                set("libraryType", e.target.value as Settings["libraryType"])
              }
            >
              <option value="user">My library</option>
              <option value="group">Group library</option>
            </select>
          </label>
        </div>

        <h2>PDF retrieval</h2>
        <div className="settings-row">
          <label className="settings-field">
            <span>Contact email (for Unpaywall / CrossRef)</span>
            <input
              type="email"
              value={draft.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
              placeholder="you@university.edu"
            />
          </label>
          <label className="settings-field">
            <span>Rate limit between downloads (ms)</span>
            <input
              type="number"
              min={250}
              step={250}
              value={draft.rateLimitMs}
              onChange={(e) => set("rateLimitMs", Number(e.target.value))}
            />
          </label>
        </div>

        <h2>AI</h2>
        <p className="hint">
          Used by Tidy Metadata, Get Abstract, and the Questions
          conversations. Optional — everything else works without it.
        </p>
        <label className="settings-field">
          <span>Service</span>
          <select
            value={service}
            onChange={(e) => pickService(e.target.value as AiService)}
          >
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
            <select
              value={chosenModel}
              onChange={(e) => set(modelField, e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="hint">
          {models.find((m) => m.id === chosenModel)?.blurb}
          {" — "}
          {(() => {
            const m = models.find((x) => x.id === chosenModel);
            return m
              ? `$${m.inputPerMTok}/M in, $${m.outputPerMTok}/M out`
              : "";
          })()}
          .
        </p>

        <div className="settings-actions">
          <button
            className="tool-btn"
            onClick={() => setView("main")}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="tool-btn accent" onClick={doSave} disabled={saving}>
            {saving ? <Spinner size={13} /> : null} Save
          </button>
        </div>
      </div>
    </div>
  );
}
