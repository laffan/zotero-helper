//! Storage for the PDF bookmarks made in the reader. Zotero has nothing
//! like them, so they live only here: one JSON file beside the library
//! cache, never sent anywhere.
//!
//! The frontend owns the shape (src/lib/bookmarks.ts `Bookmark`); this
//! side only round-trips it, held as opaque JSON.

use crate::state::AppState;
use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::State;

fn bookmarks_path(data_dir: &Path) -> PathBuf {
    data_dir.join("bookmarks.json")
}

/// Every stored bookmark. A missing or corrupt file reads as none.
fn load(data_dir: &Path) -> Vec<Value> {
    match std::fs::read_to_string(bookmarks_path(data_dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Written through a temp file and renamed, so a crash mid-write can't
/// truncate the file.
fn save(data_dir: &Path, bookmarks: &[Value]) -> Result<()> {
    let path = bookmarks_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(bookmarks)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

// --- the commands (registered in lib.rs) ---

#[tauri::command]
pub async fn load_bookmarks(state: State<'_, AppState>) -> Result<Vec<Value>> {
    Ok(load(&state.data_dir))
}

#[tauri::command]
pub async fn save_bookmarks(state: State<'_, AppState>, bookmarks: Vec<Value>) -> Result<()> {
    save(&state.data_dir, &bookmarks)
}
