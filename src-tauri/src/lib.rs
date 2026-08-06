mod ai;
mod capture;
mod error;
mod hush;
mod pdf;
mod resolve;
mod settings;
mod state;
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
async fn ai_tidy_item(app: AppHandle, state: State<'_, AppState>, item: Value) -> Result<Value> {
    ai::tidy_item(&app, &state, item).await
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
// PDF rescue browser (desktop only)
// ---------------------------------------------------------------------------

#[tauri::command]
async fn open_capture_window(
    app: AppHandle,
    state: State<'_, AppState>,
    url: String,
    job_id: String,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let tmp = state.tmp_dir();
        capture::open_capture_window(&app, url, job_id, tmp)
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, state, url, job_id);
        Err(Error::msg(
            "The embedded capture browser is desktop-only. Use “Open in browser” and then “Attach PDF file…” instead.",
        ))
    }
}

#[tauri::command]
async fn close_capture_window(app: AppHandle, job_id: String) -> Result<()> {
    #[cfg(desktop)]
    capture::close_capture_window(&app, &job_id);
    #[cfg(not(desktop))]
    let _ = (app, job_id);
    Ok(())
}

// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
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
            create_collection,
            delete_collection,
            create_zotero_items,
            update_zotero_item,
            delete_zotero_items,
            resolve_identifier,
            find_pdf_candidates,
            download_pdf,
            attach_pdf,
            discard_temp_file,
            ai_tidy_item,
            list_hush_desks,
            open_in_hush,
            open_capture_window,
            close_capture_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
