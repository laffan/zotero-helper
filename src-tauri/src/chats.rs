//! Storage for the Questions conversations. They live in one JSON file
//! beside the library cache and are never sent to Zotero — a chat is a
//! private note about your reading, not a library object.
//!
//! The frontend owns the shape (src/lib/types.ts `Chat`); this side only
//! has to round-trip it, so the whole file is held as opaque JSON.

use crate::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};

fn chats_path(data_dir: &Path) -> PathBuf {
    data_dir.join("chats.json")
}

/// Every stored chat, newest first as the frontend left them. A missing
/// or corrupt file reads as "no chats yet" rather than failing startup.
pub fn load(data_dir: &Path) -> Vec<Value> {
    match std::fs::read_to_string(chats_path(data_dir)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Written through a temp file and renamed, so a crash mid-write can't
/// truncate a conversation that took real money to produce.
pub fn save(data_dir: &Path, chats: &[Value]) -> Result<()> {
    let path = chats_path(data_dir);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(chats)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}
