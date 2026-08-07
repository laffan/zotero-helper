import { useEffect, useState } from "react";
import { bootstrap, saveSettings, syncNow, verifyKey } from "../lib/actions";
import { appLog, useStore } from "../lib/store";
import { invoke } from "../lib/tauri";
import type { Settings } from "../lib/types";
import { Spinner } from "./Icons";

type ModelInfo = { id: string; displayName: string };

const BLANK: Settings = {
  zoteroApiKey: "",
  zoteroUserId: "",
  libraryType: "user",
  contactEmail: "",
  anthropicApiKey: "",
  anthropicModel: "claude-opus-5",
  rateLimitMs: 1500,
};

export function SettingsView() {
  const stored = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const [draft, setDraft] = useState<Settings>(stored ?? BLANK);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  // Populate the model dropdown from GET /v1/models whenever a key is
  // present (debounced so we don't fire per keystroke while pasting/typing).
  const anthropicKey = draft.anthropicApiKey.trim();
  useEffect(() => {
    if (!anthropicKey) {
      setModels(null);
      return;
    }
    setModelsLoading(true);
    let stale = false;
    const t = setTimeout(() => {
      invoke<ModelInfo[]>("list_anthropic_models", { key: anthropicKey })
        .then((list) => {
          if (!stale) setModels(list);
        })
        .catch((e) => {
          if (!stale) {
            setModels(null);
            appLog("warn", `Could not list Anthropic models: ${e}`);
          }
        })
        .finally(() => {
          if (!stale) setModelsLoading(false);
        });
    }, 600);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [anthropicKey]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

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

        <h2>AI Tidy (optional)</h2>
        <div className="settings-row">
          <label className="settings-field">
            <span>Anthropic API key</span>
            <input
              type="password"
              value={draft.anthropicApiKey}
              onChange={(e) => set("anthropicApiKey", e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="settings-field">
            <span>Model {modelsLoading && <Spinner size={11} />}</span>
            {models && models.length > 0 ? (
              <select
                value={draft.anthropicModel}
                onChange={(e) => set("anthropicModel", e.target.value)}
              >
                {!models.some((m) => m.id === draft.anthropicModel) &&
                  draft.anthropicModel && (
                    <option value={draft.anthropicModel}>
                      {draft.anthropicModel} (saved)
                    </option>
                  )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} — {m.id}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.anthropicModel}
                onChange={(e) => set("anthropicModel", e.target.value)}
                placeholder="claude-opus-5"
                title="Enter an API key above to pick from your available models"
              />
            )}
          </label>
        </div>

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
