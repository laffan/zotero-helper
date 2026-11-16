//! Storage for the sections the reader adds to a PDF (Add Section in the
//! reader: a labelled dashed line across a page). Zotero has nothing
//! like them, so, like the bookmarks (bookmarks.rs), they live only
//! here: one JSON file beside the library cache, never sent anywhere.
//!
//! The frontend owns the shape (src/lib/dividers.ts `Divider`); this
//! side only round-trips it, held as opaque JSON.

use crate::state::AppState;
use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::State;

fn dividers_path(data_dir: &Path) -> PathBuf {
    data_dir.join("sections.json")
}

/// Every stored section. A missing or corrupt file reads as none.
fn load(data_dir: &Path) -> Vec<Value> {
    match std::fs::read_to_string(dividers_path(data_dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Written through a temp file and renamed, so a crash mid-write can't
/// truncate the file.
fn save(data_dir: &Path, dividers: &[Value]) -> Result<()> {
    let path = dividers_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(dividers)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

// --- the commands (registered in lib.rs) ---

#[tauri::command]
pub async fn load_dividers(state: State<'_, AppState>) -> Result<Vec<Value>> {
    Ok(load(&state.data_dir))
}

#[tauri::command]
pub async fn save_dividers(state: State<'_, AppState>, dividers: Vec<Value>) -> Result<()> {
    save(&state.data_dir, &dividers)
}
