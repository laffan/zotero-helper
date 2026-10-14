// Settings → Zotero: the API key (and the library it opens), plus what
// PDF retrieval needs — the contact email for the polite pools and the
// pause between downloads. Edits a draft; SettingsView saves it.
import { useState } from "react";
import { verifyKey } from "../../lib/actions";
import type { Settings } from "../../lib/types";
import { Spinner } from "../Icons";
import type { DraftProps } from "./SettingsView";

export function ZoteroSettings({ draft, set }: DraftProps) {
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const doVerify = async () => {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const res = await verifyKey(draft.zoteroApiKey.trim());
      const userId = res.userID != null ? String(res.userID) : "";
      if (userId) set("zoteroUserId", userId);
      setVerifyMsg(`✓ Key valid — ${res.username ?? "user"} (ID ${userId || "unknown"})`);
    } catch (e) {
      setVerifyMsg(`✗ ${e}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
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
            onChange={(e) => set("libraryType", e.target.value as Settings["libraryType"])}
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
    </>
  );
}
