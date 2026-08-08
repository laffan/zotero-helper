mod ai;
mod capture;
mod error;
mod hush;
mod pdf;
mod resolve;
mod settings;
mod share;
mod state;
mod thumbs;
mod zotero;

pub use error::{Error, Result};

use serde_json::Value;
use state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};

/// Emit a log line to the frontend terminal.
pub(crate) fn log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "app-log",
        serde_json::json!({
            "level": level,
            "message": message.into(),
            "ts": zotero::now_ms(),
        }),
    );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<settings::Settings> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: settings::Settings,
) -> Result<()> {
    settings::save(&state.data_dir, &settings)?;
    *state.settings.write().await = settings;
    log(&app, "info", "Settings saved");
    Ok(())
}

#[tauri::command]
async fn verify_zotero_key(state: State<'_, AppState>, key: String) -> Result<Value> {
    zotero::verify_key(&state, &key).await
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

#[tauri::command]
async fn load_library(state: State<'_, AppState>) -> Result<zotero::LibraryCache> {
    Ok(zotero::load_cache(&state.data_dir))
}

#[tauri::command]
async fn sync_library(
    app: AppHandle,
    state: State<'_, AppState>,
    full: bool,
) -> Result<zotero::LibraryCache> {
    zotero::sync_library(&app, &state, full).await
}

#[tauri::command]
async fn sync_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    collection_key: String,
) -> Result<zotero::LibraryCache> {
    zotero::sync_collection(&app, &state, &collection_key).await
}

#[tauri::command]
async fn create_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    parent: Option<String>,
) -> Result<Value> {
    log(&app, "info", format!("Creating collection “{name}”"));
    zotero::create_collection(&state, &name, parent).await
}

#[tauri::command]
async fn delete_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    version: u64,
) -> Result<()> {
    log(&app, "info", format!("Deleting collection {key}"));
    zotero::delete_collection(&state, &key, version).await
}

#[tauri::command]
async fn create_zotero_items(state: State<'_, AppState>, items: Vec<Value>) -> Result<Value> {
    zotero::create_items(&state, items).await
}

#[tauri::command]
async fn update_zotero_item(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    version: u64,
    patch: Value,
) -> Result<()> {
    log(&app, "info", format!("Updating item {key}"));
    zotero::update_item(&state, &key, version, patch).await
}

#[tauri::command]
async fn delete_zotero_items(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: Vec<String>,
    library_version: u64,
) -> Result<()> {
    log(&app, "info", format!("Deleting {} item(s)", keys.len()));
    zotero::delete_items(&state, keys, library_version).await
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

#[tauri::command]
async fn resolve_identifier(
    app: AppHandle,
    state: State<'_, AppState>,
    identifier: String,
) -> Result<resolve::Resolved> {
    resolve::resolve(&app, &state, &identifier).await
}

#[tauri::command]
async fn discover_doi(
    app: AppHandle,
    state: State<'_, AppState>,
    title: String,
    author: Option<String>,
    year: Option<i64>,
) -> Result<Option<String>> {
    resolve::discover_doi(&app, &state, &title, author.as_deref(), year).await
}

#[tauri::command]
async fn find_pdf_candidates(
    app: AppHandle,
    state: State<'_, AppState>,
    doi: Option<String>,
    landing_url: Option<String>,
    seed: Vec<String>,
) -> Result<Vec<String>> {
    pdf::find_candidates(&app, &state, doi, landing_url, seed).await
}

#[tauri::command]
async fn download_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    referer: Option<String>,
) -> Result<pdf::DownloadedPdf> {
    pdf::download_pdf(&app, &state, &url, referer).await
}

#[tauri::command]
async fn attach_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    parent_key: String,
    file_path: String,
    filename: Option<String>,
) -> Result<String> {
    let name = filename.unwrap_or_else(|| {
        std::path::Path::new(&file_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "document.pdf".into())
    });
    zotero::upload_attachment(&app, &state, &parent_key, &file_path, &name).await
}

#[tauri::command]
async fn discard_temp_file(state: State<'_, AppState>, path: String) -> Result<()> {
    // Only allow deleting files inside our own temp dir.
    let tmp = state.tmp_dir();
    let p = std::path::PathBuf::from(&path);
    if p.starts_with(&tmp) {
        let _ = std::fs::remove_file(p);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// AI tidy
// ---------------------------------------------------------------------------

#[tauri::command]
async fn ai_tidy_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item: Value,
    page_image: Option<String>,
) -> Result<Value> {
    ai::tidy_item(&app, &state, item, page_image).await
}

/// Raw bytes of an attachment file from Zotero storage (the frontend
/// renders page 1 for AI Tidy). Returned as a binary IPC response so the
/// PDF doesn't get JSON-encoded on the way through.
#[tauri::command]
async fn download_attachment_file(
    state: State<'_, AppState>,
    att_key: String,
) -> Result<tauri::ipc::Response> {
    let bytes = zotero::download_attachment(&state, &att_key).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// "Get Abstract": extract the abstract from LiteParse-parsed page text.
#[tauri::command]
async fn ai_get_abstract(
    app: AppHandle,
    state: State<'_, AppState>,
    item: Value,
    page_text: String,
) -> Result<String> {
    ai::get_abstract(&app, &state, item, page_text).await
}

/// Models available to an Anthropic API key (for the Settings dropdown).
/// Takes the key as an argument so the not-yet-saved key in the form works.
#[tauri::command]
async fn list_anthropic_models(
    state: State<'_, AppState>,
    key: String,
) -> Result<Vec<ai::ModelInfo>> {
    ai::list_models(&state, &key).await
}

// ---------------------------------------------------------------------------
// Hush integration
// ---------------------------------------------------------------------------

/// Desk/project roster of a local Hush install (empty when unavailable).
#[tauri::command]
async fn list_hush_desks() -> Result<Vec<hush::HushDesk>> {
    Ok(hush::list_desks())
}

/// Fire a hushwriter:// deep link at the Hush app. Restricted to that
/// scheme so this command can't be used as a generic URL opener.
#[tauri::command]
async fn open_in_hush(app: AppHandle, url: String) -> Result<()> {
    if !url.starts_with("hushwriter://") {
        return Err(Error::msg("open_in_hush only accepts hushwriter:// URLs"));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| Error::msg(format!("Could not open Hush — is it installed? ({e})")))
}

// ---------------------------------------------------------------------------
// Share (iOS share sheet via tauri-plugin-share-sheet; desktop exports
// staged files through save/folder dialogs instead)
// ---------------------------------------------------------------------------

/// Download an attachment into the share staging dir; returns the path.
#[tauri::command]
async fn stage_attachment_for_share(
    state: State<'_, AppState>,
    att_key: String,
    file_name: String,
) -> Result<String> {
    share::stage_attachment(&state, &att_key, &file_name).await
}

/// Write text (e.g. abstracts markdown) into the staging dir.
#[tauri::command]
async fn stage_text_for_share(
    state: State<'_, AppState>,
    file_name: String,
    content: String,
) -> Result<String> {
    share::stage_text(&state, &file_name, &content)
}

/// Present the iOS share sheet for staged files (x/y anchor the iPad
/// popover at the Share button). Errors on desktop — callers fall back
/// to the export commands below.
#[tauri::command]
async fn share_files(
    app: AppHandle,
    paths: Vec<String>,
    x: f64,
    y: f64,
) -> Result<()> {
    let plugin = app.state::<tauri_plugin_share_sheet::ShareSheet<tauri::Wry>>();
    plugin
        .share_files(tauri_plugin_share_sheet::ShareArgs { paths, x, y })
        .map_err(Error::msg)
}

/// Desktop: copy staged files into a chosen folder.
#[tauri::command]
async fn export_files(paths: Vec<String>, dest_dir: String) -> Result<usize> {
    share::export_to_dir(&paths, &dest_dir)
}

/// Desktop: copy one staged file to a save-dialog destination.
#[tauri::command]
async fn export_file(src: String, dest: String) -> Result<()> {
    share::export_to_file(&src, &dest)
}

/// Cached first-page thumbnail (base64 JPEG) for an attachment.
#[tauri::command]
async fn read_thumbnail(state: State<'_, AppState>, att_key: String) -> Result<Option<String>> {
    thumbs::read(&state, &att_key)
}

/// Store a first-page thumbnail rendered by the webview.
#[tauri::command]
async fn write_thumbnail(
    state: State<'_, AppState>,
    att_key: String,
    data: String,
) -> Result<()> {
    thumbs::write(&state, &att_key, &data)
}

/// Select the item in the Zotero app via its zotero://select deep link
/// (works on macOS and the iPadOS Zotero app alike).
#[tauri::command]
async fn open_in_zotero(
    app: AppHandle,
    state: State<'_, AppState>,
    item_key: String,
) -> Result<()> {
    if item_key.is_empty() || !item_key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(Error::msg("Not a real Zotero item key"));
    }
    let (library_type, library_id) = {
        let s = state.settings.read().await;
        (s.library_type.clone(), s.zotero_user_id.clone())
    };
    let url = if library_type == "group" {
        format!("zotero://select/groups/{library_id}/items/{item_key}")
    } else {
        format!("zotero://select/library/items/{item_key}")
    };
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| Error::msg(format!("Could not open Zotero — is it installed? ({e})")))
}

// ---------------------------------------------------------------------------
// PDF rescue browser. Desktop: Tauri child webview (src/capture.rs).
// Mobile: native WKWebView overlay (tauri-plugin-capture-view).
// ---------------------------------------------------------------------------

#[cfg(not(desktop))]
fn capture_plugin(app: &AppHandle) -> State<'_, tauri_plugin_capture_view::CaptureView<tauri::Wry>> {
    app.state::<tauri_plugin_capture_view::CaptureView<tauri::Wry>>()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn open_capture_window(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    job_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let tmp = state.tmp_dir();
        capture::open_capture(&app, url, job_id, tmp, x, y, w, h)
    }
    #[cfg(not(desktop))]
    {
        let _ = state;
        capture_plugin(&app)
            .open(tauri_plugin_capture_view::OpenArgs { url, job_id, x, y, w, h })
            .map_err(Error::msg)
    }
}

#[tauri::command]
async fn capture_set_bounds(
    app: AppHandle,
    job_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::set_capture_bounds(&app, &job_id, x, y, w, h);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app)
            .set_bounds(tauri_plugin_capture_view::BoundsArgs { x, y, w, h })
            .map_err(Error::msg)
    }
}

#[tauri::command]
async fn capture_back(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::capture_back(&app, &job_id);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).back().map_err(Error::msg)
    }
}

#[tauri::command]
async fn capture_grab(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    return capture::capture_grab(&app, &job_id);
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).grab().map_err(Error::msg)
    }
}

#[tauri::command]
async fn close_capture_window(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    {
        capture::close_capture(&app, &job_id);
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = job_id;
        capture_plugin(&app).close().map_err(Error::msg)
    }
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_capture_view::init())
        .plugin(tauri_plugin_share_sheet::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("could not resolve app data directory");
            std::fs::create_dir_all(&data_dir)?;
            let loaded = settings::load(&data_dir);
            // Clear stale temp PDFs from previous sessions.
            let tmp = data_dir.join("tmp");
            if tmp.exists() {
                if let Ok(entries) = std::fs::read_dir(&tmp) {
                    for e in entries.flatten() {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
            app.manage(AppState::new(data_dir, loaded));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            verify_zotero_key,
            load_library,
            sync_library,
            sync_collection,
            create_collection,
            delete_collection,
            create_zotero_items,
            update_zotero_item,
            delete_zotero_items,
            resolve_identifier,
            discover_doi,
            find_pdf_candidates,
            download_pdf,
            attach_pdf,
            discard_temp_file,
            ai_tidy_item,
            ai_get_abstract,
            list_anthropic_models,
            download_attachment_file,
            list_hush_desks,
            open_in_hush,
            open_in_zotero,
            read_thumbnail,
            write_thumbnail,
            stage_attachment_for_share,
            stage_text_for_share,
            share_files,
            export_files,
            export_file,
            open_capture_window,
            capture_set_bounds,
            capture_back,
            capture_grab,
            close_capture_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
