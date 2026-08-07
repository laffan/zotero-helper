//! iOS share sheet: presents a UIActivityViewController for a list of
//! files, anchored near the on-screen point the frontend reports (iPad
//! presents share sheets as popovers, which need an anchor).
//!
//! Desktop never calls this — the frontend falls back to save dialogs
//! there. All methods return Err off-iOS so callers can branch cleanly.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_share_sheet);

pub struct ShareSheet<R: Runtime>(Option<PluginHandle<R>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareArgs {
    pub paths: Vec<String>,
    /// Popover anchor in CSS pixels of the main webview (≈ UIKit points).
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
struct EmptyResponse {}

impl<R: Runtime> ShareSheet<R> {
    pub fn share_files(&self, args: ShareArgs) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            match self.0.as_ref() {
                Some(handle) => handle
                    .run_mobile_plugin::<EmptyResponse>("shareFiles", args)
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                None => Err("share-sheet plugin not initialized".into()),
            }
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = args;
            Err("the system share sheet is iOS-only".into())
        }
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("share-sheet")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_share_sheet)?;
                app.manage(ShareSheet::<R>(Some(handle)));
            }
            #[cfg(not(target_os = "ios"))]
            {
                app.manage(ShareSheet::<R>(None));
            }
            Ok(())
        })
        .build()
}
