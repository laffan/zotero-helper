//! iOS in-app capture browser: a native WKWebView overlaid on the main
//! webview at bounds the frontend reports, with PDF downloads
//! intercepted by MIME type (WKDownload — cookie/session-aware, so it
//! works on pages the Rust HTTP client couldn't fetch). The Swift side
//! emits plugin events the frontend subscribes to:
//!   captured  { jobId, path }    — a PDF landed in the temp dir
//!   failed    { jobId, message } — a download/grab attempt failed
//!
//! On desktop this plugin is an inert shell — the app uses Tauri's
//! multiwebview child instead (src/capture.rs). All methods here return
//! Err off-iOS so callers can branch cleanly.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_capture_view);

pub struct CaptureView<R: Runtime>(Option<PluginHandle<R>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenArgs {
    pub url: String,
    pub job_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize)]
pub struct BoundsArgs {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
struct EmptyResponse {}

impl<R: Runtime> CaptureView<R> {
    fn call(&self, method: &str, args: impl Serialize) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            match self.0.as_ref() {
                Some(handle) => handle
                    .run_mobile_plugin::<EmptyResponse>(method, args)
                    .map(|_| ())
                    .map_err(|e| e.to_string()),
                None => Err("capture-view plugin not initialized".into()),
            }
        }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (method, args);
            Err("the capture view plugin is iOS-only".into())
        }
    }

    pub fn open(&self, args: OpenArgs) -> Result<(), String> {
        self.call("openCapture", args)
    }
    pub fn set_bounds(&self, args: BoundsArgs) -> Result<(), String> {
        self.call("setBounds", args)
    }
    pub fn back(&self) -> Result<(), String> {
        self.call("goBack", serde_json::json!({}))
    }
    pub fn grab(&self) -> Result<(), String> {
        self.call("grabPage", serde_json::json!({}))
    }
    pub fn close(&self) -> Result<(), String> {
        self.call("closeCapture", serde_json::json!({}))
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("capture-view")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_capture_view)?;
                app.manage(CaptureView::<R>(Some(handle)));
            }
            #[cfg(not(target_os = "ios"))]
            {
                app.manage(CaptureView::<R>(None));
            }
            Ok(())
        })
        .build()
}
