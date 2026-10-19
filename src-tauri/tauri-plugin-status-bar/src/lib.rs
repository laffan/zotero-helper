//! iPadOS full screen: while the app's window fills the screen, the
//! status bar is hidden and the home indicator fades, so the app has the
//! whole screen. A window that doesn't (Split View, Stage Manager,
//! iPadOS 26+ windowing) keeps its bar, which is where the system puts
//! the window controls. The page hears which it is as the
//! `status-bar-hidden` class on `<html>` (base.css drops the band kept
//! clear for the bar), set by the native side whenever it changes and
//! once more when the page calls `refresh` as it boots
//! (src/lib/statusBar.ts).
//!
//! See ios/Sources/StatusBarPlugin.swift. Everywhere but iOS this is a
//! no-op.

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_status_bar);

#[cfg(target_os = "ios")]
struct StatusBar<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "ios")]
#[derive(serde::Deserialize)]
struct Empty {}

#[tauri::command]
async fn refresh<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let handle = &app.state::<StatusBar<R>>().0;
        handle
            .run_mobile_plugin::<Empty>("refresh", ())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("status-bar")
        .invoke_handler(tauri::generate_handler![refresh])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_status_bar)?;
                _app.manage(StatusBar(handle));
            }
            Ok(())
        })
        .build()
}
