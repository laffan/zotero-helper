// The settings window: an overlay over the app, centred, with a list of
// sections at the left and the open section beside it. Escape or a
// press on the backdrop closes it (as Close does, dropping unsaved
// edits). Zotero and AI edit a draft of the stored settings (kept in
// the Rust core), committed by Save; General, Cache and Keyboard
// Shortcuts are this device's and act at once.
import { useEffect, useState } from "react";
import { bootstrap, saveSettings, syncNow } from "../../lib/actions";
import { reclaimKeyboard } from "../../lib/shortcuts/dispatch";
import { appLog, useStore } from "../../lib/store";
import type { Settings } from "../../lib/types";
import { Spinner } from "../Icons";
import { AiSettings } from "./AiSettings";
import { CacheSettings } from "./CacheSettings";
import { GeneralSettings } from "./GeneralSettings";
import { ShortcutSettings } from "./ShortcutSettings";
import { ZoteroSettings } from "./ZoteroSettings";

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

type SectionId = "general" | "zotero" | "cache" | "ai" | "shortcuts";

const SECTIONS: { id: SectionId; label: string; drafted?: boolean }[] = [
  { id: "general", label: "General" },
  { id: "zotero", label: "Zotero", drafted: true },
  { id: "cache", label: "Cache" },
  { id: "ai", label: "AI", drafted: true },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
];

/** The section last open, for coming back to Settings. */
let lastSection: SectionId | null = null;

/** What a section that edits the stored settings is handed. */
export interface DraftProps {
  draft: Settings;
  set: <K extends keyof Settings>(k: K, v: Settings[K]) => void;
  setDraft: React.Dispatch<React.SetStateAction<Settings>>;
}

export function SettingsView() {
  const stored = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const [draft, setDraft] = useState<Settings>(stored ?? BLANK);
  const [saving, setSaving] = useState(false);
  // A first launch has no key yet: open on the section that needs one.
  const [section, setSection] = useState<SectionId>(
    lastSection ?? (stored?.zoteroApiKey ? "general" : "zotero"),
  );

  useEffect(() => {
    if (stored) setDraft(stored);
  }, [stored]);

  // While it is up, the app beneath takes no keys or presses: a notes
  // editor still focused there would otherwise get the typing (iPad's
  // hardware keyboard follows focus, not what is on top).
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".app");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    app?.setAttribute("inert", "");
    return () => {
      app?.removeAttribute("inert");
      reclaimKeyboard();
    };
  }, []);

  // Escape closes — unless something in the page spent it first (a key
  // being recorded, a field's own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !saving) setView("main");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, setView]);

  const pick = (id: SectionId) => {
    lastSection = id;
    setSection(id);
  };

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

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

  const props: DraftProps = { draft, set, setDraft };
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  // Unsaved edits to the draft, so leaving a section doesn't hide them.
  const dirty = Boolean(stored) && JSON.stringify(stored) !== JSON.stringify(draft);

  return (
    <div className="settings-view" onMouseDown={() => !saving && setView("main")}>
      <div
        className="settings-card"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="settings-nav" aria-label="Settings sections">
          <h1>Settings</h1>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${s.id === section ? "on" : ""}`}
              onClick={() => pick(s.id)}
              aria-current={s.id === section ? "page" : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          <section className="settings-section" aria-label={current.label}>
            <h2 className="settings-section-title">{current.label}</h2>
            {section === "general" && <GeneralSettings />}
            {section === "zotero" && <ZoteroSettings {...props} />}
            {section === "cache" && <CacheSettings />}
            {section === "ai" && <AiSettings {...props} />}
            {section === "shortcuts" && <ShortcutSettings />}
          </section>
          <div className="settings-actions">
            <span className="settings-actions-note">
              {current.drafted
                ? dirty
                  ? "Unsaved changes"
                  : ""
                : "Changes here apply at once"}
            </span>
            <button className="tool-btn" onClick={() => setView("main")} disabled={saving}>
              {dirty ? "Cancel" : "Close"}
            </button>
            <button className="tool-btn accent" onClick={doSave} disabled={saving || (!dirty && Boolean(stored))}>
              {saving ? <Spinner size={13} /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
