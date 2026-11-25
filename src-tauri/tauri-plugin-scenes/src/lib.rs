//! iPadOS windows, once the app takes more than one
//! (`UIApplicationSupportsMultipleScenes`, src-tauri/Info.ios.plist).
//!
//! The windows the app opens itself (the header's New Window menu,
//! src/lib/windows/) are made by the page, as `WebviewWindow`s: Tauri
//! asks iPadOS for a scene for each. The system asks for scenes of its
//! own too — New Window from the app icon's menu or the App Exposé "+",
//! a scene put back after a relaunch — and Tauri hands those over as
//! `RunEvent::SceneRequested` with no window in them. This builds one,
//! the app as it opens (a fresh window), for each application scene;
//! not for a connected monitor's session (declined, here and by the
//! Swift side, ios/Sources/ScenesPlugin.swift, which also sends links
//! to a window already open), nor for a role unknown, nor past a cap —
//! a stop on a runaway loop of scenes asking for scenes (in Hush, tao's
//! `set_focus` asked for one each time it was called).
//!
//! Ported from Hush's `ios_scene.rs` and tauri-plugin-scene-reuse.
//! Everywhere but iOS this is a no-op.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_scenes);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    // Windows built for the system's scenes so far.
    #[cfg(target_os = "ios")]
    let mut built = 0u32;
    Builder::new("scenes")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_scenes)?;
            Ok(())
        })
        .on_event(move |_app, _event| {
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::SceneRequested { scene, .. } = _event {
                // The event's `Retained<UIScene>`, as the object it is.
                let ptr = &**scene as *const _ as *mut objc2::runtime::AnyObject;
                if unsafe { ios::accept(ptr, built) } {
                    built += 1;
                    ios::build(_app, built);
                }
            }
        })
        .build()
}

#[cfg(target_os = "ios")]
mod ios {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use std::ffi::{c_char, CStr};
    use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindowBuilder};

    /// Windows built for the system's scenes in one run, at most: nobody
    /// opens nine iPad windows; a loop does.
    const MAX_SCENE_WINDOWS: u32 = 8;

    /// An `NSString`'s text.
    unsafe fn text(s: *mut AnyObject) -> String {
        if s.is_null() {
            return String::new();
        }
        let chars: *const c_char = unsafe { msg_send![s, UTF8String] };
        if chars.is_null() {
            String::new()
        } else {
            unsafe { CStr::from_ptr(chars) }.to_string_lossy().into_owned()
        }
    }

    /// Ask for a scene's session to be torn down (a monitor's).
    unsafe fn destroy(scene: *mut AnyObject) {
        unsafe {
            let session: *mut AnyObject = msg_send![scene, session];
            let app: *mut AnyObject = msg_send![objc2::class!(UIApplication), sharedApplication];
            if session.is_null() || app.is_null() {
                return;
            }
            let _: () = msg_send![
                app,
                requestSceneSessionDestruction: session,
                options: std::ptr::null_mut::<AnyObject>(),
                errorHandler: std::ptr::null_mut::<AnyObject>()
            ];
        }
    }

    /// Whether to build a window for `scene`, `built` having been built
    /// so far. The role is matched by its name: the external display's
    /// was renamed in iOS 16 and both names are still handed out.
    ///
    /// # Safety
    /// `scene` must be a live `UIScene`.
    pub unsafe fn accept(scene: *mut AnyObject, built: u32) -> bool {
        if scene.is_null() {
            return false;
        }
        let role = unsafe {
            let session: *mut AnyObject = msg_send![scene, session];
            if session.is_null() {
                String::new()
            } else {
                text(msg_send![session, role])
            }
        };
        if role.contains("ExternalDisplay") {
            eprintln!("scenes: declined an external-display scene; iPadOS mirrors instead");
            unsafe { destroy(scene) };
            return false;
        }
        if !role.contains("WindowSceneSessionRoleApplication") {
            eprintln!("scenes: declined a scene of unknown role {role:?}");
            return false;
        }
        if built >= MAX_SCENE_WINDOWS {
            eprintln!("scenes: refused a scene, {built} built already — something asks for scenes in a loop");
            return false;
        }
        true
    }

    /// The window for the system's `n`th scene: the app as it opens.
    pub fn build<R: Runtime>(app: &AppHandle<R>, n: u32) {
        let label = format!("window-scene-{n}");
        if let Err(e) = WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::default()).build() {
            eprintln!("scenes: could not build {label}: {e}");
        }
    }
}
