// Copying text, for every Copy button in the app (the selection bar, a
// highlight's editor, the Highlights tab, the log).
//
// The web's own clipboard is unreliable in the app's web view: WebKit
// lets `navigator.clipboard.writeText` through only inside a user
// gesture, and only in what it counts as a secure context, and the old
// `execCommand("copy")` copies the page's selection, which a tap on a
// Copy button may already have cleared. So the text is written by the
// system itself, through tauri-plugin-clipboard-manager — no gesture, no
// selection needed — and the web's clipboard is tried at the same time,
// while the gesture is still running, for a plain browser (and in case
// the plugin is missing). Either one succeeding is a copy.
import { writeText as writeNative } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "./tauri";

/** Put `text` on the clipboard; resolves whether it got there. Call it
 *  straight from the press or click, before any `await`. */
export function copyText(text: string): Promise<boolean> {
  const tries: Promise<unknown>[] = [];
  try {
    if (navigator.clipboard?.writeText) tries.push(navigator.clipboard.writeText(text));
  } catch (e) {
    tries.push(Promise.reject(e));
  }
  if (isTauri) tries.push(writeNative(text));
  if (!tries.length) return Promise.resolve(false);
  return Promise.any(tries).then(
    () => true,
    () => false,
  );
}
