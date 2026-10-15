//! iPadOS Apple Pencil: forwards the Pencil's double-tap (2nd
//! generation, Pro) and squeeze (Pro) to the page as plugin events,
//! each with the action the system's Pencil setting asks for (see
//! ios/Sources/PencilPlugin.swift). Nothing else about the Pencil needs
//! native help: the page tells it from a finger by
//! `PointerEvent.pointerType`.
//!
//! Everywhere but iOS this is a no-op.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_pencil);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("pencil")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_pencil)?;
            Ok(())
        })
        .build()
}
