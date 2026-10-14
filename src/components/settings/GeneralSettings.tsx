// Settings → General: how the app looks on this device. Applied as soon
// as it is picked (lib/appearance.ts) — no Save needed.
import { APPEARANCES, BASE_FONT_SIZE, FONT_SIZES, type Appearance } from "../../lib/appearance";
import { useStore } from "../../lib/store";

export function GeneralSettings() {
  const appearance = useStore((s) => s.appearance);
  const setAppearance = useStore((s) => s.setAppearance);
  const fontSize = useStore((s) => s.uiFontSize);
  const setFontSize = useStore((s) => s.setUiFontSize);

  return (
    <>
      <p className="hint">These apply at once, and to this device only.</p>
      <div className="settings-field">
        <span>Appearance</span>
        <div className="settings-segmented" role="radiogroup" aria-label="Appearance">
          {APPEARANCES.map((a) => (
            <button
              key={a.id}
              role="radio"
              aria-checked={appearance === a.id}
              className={appearance === a.id ? "on" : ""}
              onClick={() => setAppearance(a.id as Appearance)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <label className="settings-field">
        <span>UI font size</span>
        <select value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}>
          {FONT_SIZES.map((px) => (
            <option key={px} value={px}>
              {px} px{px === BASE_FONT_SIZE ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Scales the text of the whole interface — lists, panels, the notes
        and the toolbars. PDF pages keep their own zoom.
      </p>
    </>
  );
}
