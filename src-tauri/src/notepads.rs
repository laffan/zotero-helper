//! Storage for reading mode's notepads: one per PDF, the Pencil's
//! writing on it and the links it holds to places in the pages. The
//! app's own — `notepads/<attachment key>.json` in its data folder,
//! never sent to Zotero.
//!
//! The frontend owns the shape (src/lib/notepad.ts `Notepad`); this side
//! only round-trips it, held as opaque JSON.

use crate::state::AppState;
use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::State;

/// The file for one PDF. Attachment keys are Zotero's eight characters
/// (letters and digits); anything else is refused rather than allowed
/// to name a path.
fn notepad_path(data_dir: &Path, att_key: &str) -> Result<PathBuf> {
    if att_key.is_empty() || !att_key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(crate::error::Error::msg(format!("not an attachment key: {att_key}")));
    }
    Ok(data_dir.join("notepads").join(format!("{att_key}.json")))
}

// --- the commands (registered in lib.rs) ---

/// The PDF's notepad, or null when it has none (or it can't be read).
#[tauri::command]
pub async fn load_notepad(state: State<'_, AppState>, att_key: String) -> Result<Value> {
    let path = notepad_path(&state.data_dir, &att_key)?;
    Ok(std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null))
}

/// Written through a temp file and renamed, so a crash mid-write can't
/// truncate it.
#[tauri::command]
pub async fn save_notepad(state: State<'_, AppState>, att_key: String, notepad: Value) -> Result<()> {
    let path = notepad_path(&state.data_dir, &att_key)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(&notepad)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
