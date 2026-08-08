//! First-page thumbnail cache for the folder icon view.
//!
//! The webview renders page 1 of a PDF (annotations included) with
//! pdf.js and hands us the JPEG; we keep it under the app data dir so
//! the render happens once per attachment rather than once per launch.
//! Purely a cache — deleting it costs nothing but a re-render.

use crate::state::AppState;
use crate::{Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::path::PathBuf;

/// Attachment keys are Zotero object keys (8 alphanumerics); refuse
/// anything else so a key can never escape the cache directory.
fn thumb_path(state: &AppState, key: &str) -> Result<PathBuf> {
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(Error::msg("Invalid attachment key"));
    }
    let dir = state.data_dir.join("thumbs");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{key}.jpg")))
}

/// Cached thumbnail as base64 JPEG, or None when not rendered yet.
pub fn read(state: &AppState, key: &str) -> Result<Option<String>> {
    let path = thumb_path(state, key)?;
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(STANDARD.encode(bytes))),
        Err(_) => Ok(None),
    }
}

pub fn write(state: &AppState, key: &str, base64_jpeg: &str) -> Result<()> {
    let bytes = STANDARD
        .decode(base64_jpeg)
        .map_err(|e| Error::msg(format!("Bad thumbnail data: {e}")))?;
    std::fs::write(thumb_path(state, key)?, bytes)?;
    Ok(())
}
