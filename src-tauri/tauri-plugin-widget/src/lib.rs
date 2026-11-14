//! The Continue Reading widget on the iOS home screen
//! (src-tauri/ios-widget/), from the app's side:
//!
//! - `update`: the PDFs read last — title, author, the page each was left
//!   on — and thumbnails of those pages, handed to ios/Sources/
//!   WidgetPlugin.swift, which writes them where the widget can read them
//!   (the app group both share) and has the widgets drawn again.
//! - The links the widget opens the app with
//!   (`zoterohelper://open?item=…&att=…&page=…`), kept until the page
//!   takes them (`take_open_url`) and announced as they come (the
//!   `open-url` event). One that opens the running app arrives as tao's
//!   `Opened` event. One that launches it doesn't: the scene it launches
//!   brings the link in its connection options, which tao reads nothing
//!   from — so `catch_launch_url`, called before the app runs, wraps the
//!   app delegate's answer to UIKit's request for the new scene's
//!   configuration (tao's `application:configurationForConnecting
//!   SceneSession:options:`), which is given the same options first.
//!
//! Everywhere but iOS this does nothing.

use std::sync::Mutex;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
#[cfg(target_os = "ios")]
use tauri::{plugin::PluginHandle, Emitter, Manager};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_widget);

#[cfg(target_os = "ios")]
struct Widget<R: Runtime>(PluginHandle<R>);

/// The app's own scheme (Info.ios.plist's CFBundleURLTypes).
pub const SCHEME: &str = "zoterohelper";

/// The last link the app was opened with, until the page takes it.
static PENDING: Mutex<Option<String>> = Mutex::new(None);

#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
fn remember(url: String) {
    if url.starts_with(&format!("{SCHEME}:")) {
        if let Ok(mut p) = PENDING.lock() {
            *p = Some(url);
        }
    }
}

/// What the native side wrote: how many PDFs the widget now lists, and
/// the folder it wrote them in (the app group's), for the page's log.
/// It answers with this rather than with nothing: a bare
/// `invoke.resolve()` reaches Rust as `null`, which no struct decodes
/// from, so every update that worked read as one that failed.
#[derive(serde::Deserialize, serde::Serialize, Default)]
struct Written {
    listed: usize,
    folder: String,
}

/// The widget's PDFs and any new thumbnails, as the page sends them:
/// `{ entries: [{ itemKey, attKey, title, author, page, pageCount,
/// openedMs }], thumbnails: { attKey: base64 JPEG } }`.
#[tauri::command]
async fn update<R: Runtime>(
    app: AppHandle<R>,
    payload: serde_json::Value,
) -> Result<Written, String> {
    #[cfg(target_os = "ios")]
    let written = app
        .state::<Widget<R>>()
        .0
        .run_mobile_plugin::<Written>("update", payload)
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "ios"))]
    let written = {
        let _ = (app, payload);
        Written::default()
    };
    Ok(written)
}

/// The link the app was last opened with, once.
#[tauri::command]
fn take_open_url() -> Option<String> {
    PENDING.lock().ok().and_then(|mut p| p.take())
}

/// Call between building the app and running it: a link that launches
/// the app is caught on its way in (see the module's comment).
pub fn catch_launch_url() {
    #[cfg(target_os = "ios")]
    launch::install();
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("widget")
        .invoke_handler(tauri::generate_handler![update, take_open_url])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_widget)?;
                _app.manage(Widget(handle));
            }
            Ok(())
        })
        .on_event(|_app, _event| {
            // A link opening the running app (the widget tapped while
            // the app was in the background).
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    remember(url.to_string());
                }
                let _ = _app.emit("open-url", ());
            }
        })
        .build()
}

#[cfg(target_os = "ios")]
mod launch {
    //! The app delegate's scene configuration, wrapped: tao's answer is
    //! given as ever, after the connection options' links are kept.
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{msg_send, sel};
    use std::ffi::{c_char, CStr};
    use std::sync::OnceLock;

    type Configure = unsafe extern "C-unwind" fn(
        *mut AnyObject,
        Sel,
        *mut AnyObject,
        *mut AnyObject,
        *mut AnyObject,
    ) -> *mut AnyObject;

    static TAOS: OnceLock<Configure> = OnceLock::new();

    unsafe extern "C-unwind" fn configure(
        this: *mut AnyObject,
        cmd: Sel,
        application: *mut AnyObject,
        session: *mut AnyObject,
        options: *mut AnyObject,
    ) -> *mut AnyObject {
        if !options.is_null() {
            unsafe { keep_links(options) };
        }
        match TAOS.get() {
            Some(taos) => unsafe { taos(this, cmd, application, session, options) },
            None => std::ptr::null_mut(),
        }
    }

    /// `options.URLContexts`, each one's `URL.absoluteString`.
    unsafe fn keep_links(options: *mut AnyObject) {
        unsafe {
            let contexts: *mut AnyObject = msg_send![options, URLContexts];
            if contexts.is_null() {
                return;
            }
            let all: *mut AnyObject = msg_send![contexts, allObjects];
            let count: usize = msg_send![all, count];
            for i in 0..count {
                let context: *mut AnyObject = msg_send![all, objectAtIndex: i];
                let url: *mut AnyObject = msg_send![context, URL];
                if url.is_null() {
                    continue;
                }
                let text: *mut AnyObject = msg_send![url, absoluteString];
                if text.is_null() {
                    continue;
                }
                let chars: *const c_char = msg_send![text, UTF8String];
                if !chars.is_null() {
                    super::remember(CStr::from_ptr(chars).to_string_lossy().into_owned());
                }
            }
        }
    }

    /// tao declares its `AppDelegate` as the event loop is made (when the
    /// app is built), and UIKit asks it for the first scene once the app
    /// runs: in between, its method is wrapped. Once only.
    pub fn install() {
        if TAOS.get().is_some() {
            return;
        }
        let Some(class) = AnyClass::get(c"AppDelegate") else {
            return;
        };
        let Some(method) = class.instance_method(sel!(application:configurationForConnectingSceneSession:options:)) else {
            return;
        };
        // SAFETY: the same signature as tao's method, which ours calls on:
        // kept before ours takes its place.
        let taos = unsafe { std::mem::transmute::<Imp, Configure>(method.implementation()) };
        if TAOS.set(taos).is_err() {
            return;
        }
        let ours: Configure = configure;
        unsafe { method.set_implementation(std::mem::transmute::<Configure, Imp>(ours)) };
    }
}
