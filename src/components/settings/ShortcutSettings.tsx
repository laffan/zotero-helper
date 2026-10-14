// Settings → Keyboard Shortcuts: every rebindable shortcut, by where it
// works (lib/shortcuts/bindings.ts). A key chip is pressed to record a
// new combo for it (Escape gives up), × takes one off, + adds one; a
// key that two actions in the same place share is flagged. Changes
// apply at once and are kept on this device.
import { useEffect, useState } from "react";
import {
  ACTIONS,
  bindingsOf,
  CONTEXT_LABELS,
  conflictsWith,
  eventCombo,
  FIXED_SHORTCUTS,
  formatCombo,
  useShortcuts,
  type ShortcutContext,
} from "../../lib/shortcuts/bindings";
import { CloseIcon } from "../Icons";

/** Which chip is recording: an action and the binding's index (its
 *  length, for a new one). */
type Recording = { id: string; index: number } | null;

function useRecorder(recording: Recording, done: (combo: string | null) => void): void {
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      // Capture phase, ahead of the app's own shortcuts.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return done(null);
      const combo = eventCombo(e);
      if (combo) done(combo);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, done]);
}

export function ShortcutSettings() {
  const custom = useShortcuts((s) => s.custom);
  const setBindings = useShortcuts((s) => s.setBindings);
  const resetAll = useShortcuts((s) => s.resetAll);
  const [recording, setRecording] = useState<Recording>(null);

  const finish = (combo: string | null) => {
    if (recording && combo) {
      const list = bindingsOf(recording.id, custom).slice();
      list[recording.index] = combo;
      // The same combo twice on one action is once.
      setBindings(recording.id, [...new Set(list)]);
    }
    setRecording(null);
  };
  useRecorder(recording, finish);

  const remove = (id: string, index: number) =>
    setBindings(id, bindingsOf(id, custom).filter((_, i) => i !== index));

  const contexts = Object.keys(CONTEXT_LABELS) as ShortcutContext[];
  const changed = Object.keys(custom).length > 0;

  return (
    <>
      <p className="hint">
        Press a key to record a new one for it (Esc cancels). Letters and
        arrows don't act while you are typing in a field or the notes.
      </p>
      {contexts.map((ctx) => (
        <div className="shortcut-group" key={ctx}>
          <h2>{CONTEXT_LABELS[ctx]}</h2>
          <ul className="shortcut-list">
            {ACTIONS.filter((a) => a.context === ctx).map((a) => {
              const combos = bindingsOf(a.id, custom);
              const isCustom = a.id in custom;
              return (
                <li key={a.id} className="shortcut-row">
                  <span className="shortcut-label">
                    {a.label}
                    {isCustom && (
                      <button
                        className="link-btn shortcut-reset"
                        onClick={() => setBindings(a.id, a.defaults)}
                        title={`Default: ${a.defaults.map(formatCombo).join(", ") || "none"}`}
                      >
                        Default
                      </button>
                    )}
                  </span>
                  <span className="shortcut-keys">
                    {combos.map((c, i) => {
                      const clash = conflictsWith(a.id, c, custom);
                      const rec = recording?.id === a.id && recording.index === i;
                      return (
                        <span key={`${c}-${i}`} className={`shortcut-chip ${clash.length ? "clash" : ""}`}>
                          <button
                            className="shortcut-key"
                            onClick={() => setRecording(rec ? null : { id: a.id, index: i })}
                            title={
                              clash.length
                                ? `Also bound to: ${clash.map((x) => x.label).join(", ")}`
                                : "Press to record a new key"
                            }
                          >
                            {rec ? "Press keys…" : formatCombo(c)}
                          </button>
                          <button
                            className="shortcut-remove"
                            onClick={() => remove(a.id, i)}
                            aria-label={`Remove ${formatCombo(c)}`}
                            title="Remove this key"
                          >
                            <CloseIcon size={10} />
                          </button>
                        </span>
                      );
                    })}
                    {recording?.id === a.id && recording.index === combos.length ? (
                      <span className="shortcut-chip">
                        <button className="shortcut-key" onClick={() => setRecording(null)}>
                          Press keys…
                        </button>
                      </span>
                    ) : (
                      <button
                        className="shortcut-add"
                        onClick={() => setRecording({ id: a.id, index: combos.length })}
                        title="Add a key"
                        aria-label={`Add a key for ${a.label}`}
                      >
                        +
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div>
        <button className="mini-btn" disabled={!changed} onClick={resetAll}>
          Reset all to defaults
        </button>
      </div>

      <div className="shortcut-group">
        <h2>Built in</h2>
        <ul className="shortcut-list">
          {FIXED_SHORTCUTS.map((f) => (
            <li key={`${f.context}-${f.keys}-${f.label}`} className="shortcut-row">
              <span className="shortcut-label">
                <span className="shortcut-context">{f.context}</span> {f.label}
              </span>
              <span className="shortcut-keys">
                <span className="shortcut-chip fixed">
                  <span className="shortcut-key">{formatCombo(f.keys)}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
