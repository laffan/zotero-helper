// The app full screen on the iPad: while its window fills the screen
// the status bar is hidden (src-tauri/tauri-plugin-status-bar), and the
// native side marks <html> `status-bar-hidden`, which drops the band
// base.css otherwise keeps clear at the top for the bar and the window
// controls. It marks it whenever that changes; a class set before the
// page loaded is lost, so the page asks once as it boots.
import { invoke, isTauri } from "./tauri";

/** Ask to be told whether the bar is hidden. Called once, from
 *  main.tsx. */
export function askStatusBar(): void {
  if (!isTauri || !document.documentElement.classList.contains("ipados")) return;
  void invoke("plugin:status-bar|refresh").catch(() => {});
}
