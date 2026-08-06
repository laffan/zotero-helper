// Thin wrapper around the Tauri IPC so the UI can also load in a plain
// browser during development (commands then fail gracefully).
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri) {
    throw new Error(
      `“${cmd}” requires the desktop/mobile app (running in a plain browser)`,
    );
  }
  return tauriInvoke<T>(cmd, args);
}

export async function on<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return listen<T>(event, (e) => handler(e.payload));
}
