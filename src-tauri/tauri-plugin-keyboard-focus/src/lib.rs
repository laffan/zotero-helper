//! iPadOS hardware keyboard: makes the app's web view the first
//! responder, without which no hardware key reaches the page at all
//! (see ios/Sources/KeyboardFocusPlugin.swift for the why). The native
//! side claims it by itself at launch, on window / scene activation and
//! when a keyboard connects; `claim` asks again from the frontend —
//! after the page lets a text field go, which can hand the role back.
//!
//! Everywhere but iOS this is a no-op: desktop web views already get
//! the keyboard.

use serde::Deserialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_keyboard_focus);

pub struct KeyboardFocus<R: Runtime>(Option<PluginHandle<R>>);

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
struct EmptyResponse {}

impl<R: Runtime> KeyboardFocus<R> {
    pub fn claim(&self) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            match self.0.as_ref() {
                Some(handle) => handle
                    .run_mobile_plugin::<EmptyResponse>("claim", serde_json::json!({}))
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                None => Ok(()),
            }
        }
        #[cfg(not(target_os = "ios"))]
        {
            Ok(())
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("keyboard-focus")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_keyboard_focus)?;
                app.manage(KeyboardFocus::<R>(Some(handle)));
            }
            #[cfg(not(target_os = "ios"))]
            {
                app.manage(KeyboardFocus::<R>(None));
            }
            Ok(())
        })
        .build()
}
