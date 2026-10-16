//! The iPad's input around the PDF pages, where it needs native help:
//!
//! - The Apple Pencil's double-tap (2nd generation, Pro) and squeeze
//!   (Pro), forwarded to the page as plugin events, each with the action
//!   the system's Pencil setting asks for. Nothing else about the Pencil
//!   needs native help: the page tells it from a finger by
//!   `PointerEvent.pointerType`.
//! - `hide_edit_menu`: dismiss the system's text-selection menu (Copy,
//!   Look Up, …), which would cover the viewer's own bar over a
//!   selection in the PDF — and which the page has no way to suppress.
//!
//! See ios/Sources/PencilPlugin.swift. Everywhere but iOS this is a
//! no-op.

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_pencil);

#[cfg(target_os = "ios")]
struct Pencil<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "ios")]
#[derive(serde::Deserialize)]
struct Empty {}

#[tauri::command]
async fn hide_edit_menu<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let handle = &app.state::<Pencil<R>>().0;
        handle
            .run_mobile_plugin::<Empty>("hideEditMenu", ())
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "ios"))]
    let _ = app;
    Ok(())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pencil")
        .invoke_handler(tauri::generate_handler![hide_edit_menu])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_pencil)?;
                _app.manage(Pencil(handle));
            }
            Ok(())
        })
        .build()
}
