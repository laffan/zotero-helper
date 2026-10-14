//! iPadOS hardware keyboard: makes the app's web view the first
//! responder, without which no hardware key reaches the page at all
//! (see ios/Sources/KeyboardFocusPlugin.swift for the why). The native
//! side does it by itself — at launch, on window / scene activation and
//! when a keyboard connects — so there is nothing to call. The page
//! deliberately can't ask for it: becoming first responder refocuses the
//! page, which can put the focus back into a field it just let go.
//!
//! Everywhere but iOS this is a no-op: desktop web views already get
//! the keyboard.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_keyboard_focus);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keyboard-focus")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_keyboard_focus)?;
            Ok(())
        })
        .build()
}
