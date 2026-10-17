//! Storage for the reader's Words: every word or phrase looked up from
//! the PDF viewer's selection bar, with its definition and where it was
//! read. They are the app's own — one JSON file beside the library
//! cache, never sent to Zotero.
//!
//! The frontend owns the shape (src/lib/words.ts `WordEntry`); this side
//! only round-trips it, held as opaque JSON.

use crate::state::AppState;
use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::State;

fn words_path(data_dir: &Path) -> PathBuf {
    data_dir.join("words.json")
}

/// Every stored word. A missing or corrupt file reads as none.
fn load(data_dir: &Path) -> Vec<Value> {
    match std::fs::read_to_string(words_path(data_dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Written through a temp file and renamed, so a crash mid-write can't
/// truncate the file.
fn save(data_dir: &Path, words: &[Value]) -> Result<()> {
    let path = words_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(words)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

// --- the commands (registered in lib.rs) ---

#[tauri::command]
pub async fn load_words(state: State<'_, AppState>) -> Result<Vec<Value>> {
    Ok(load(&state.data_dir))
}

#[tauri::command]
pub async fn save_words(state: State<'_, AppState>, words: Vec<Value>) -> Result<()> {
    save(&state.data_dir, &words)
}
