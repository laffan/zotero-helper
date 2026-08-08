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

fn thumbs_dir(state: &AppState) -> Result<PathBuf> {
    let dir = state.data_dir.join("thumbs");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// `<key>_<variant>.jpg`. Both parts must be alphanumeric — Zotero
/// object keys are, and the variant is a caller-computed signature — so
/// neither can escape the cache directory.
fn thumb_path(state: &AppState, key: &str, variant: &str) -> Result<PathBuf> {
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric());
    if !ok(key) || !ok(variant) {
        return Err(Error::msg("Invalid thumbnail key"));
    }
    Ok(thumbs_dir(state)?.join(format!("{key}_{variant}.jpg")))
}

/// Cached thumbnail as base64 JPEG, or None when this variant hasn't
/// been rendered (a stale variant counts as a miss).
pub fn read(state: &AppState, key: &str, variant: &str) -> Result<Option<String>> {
    match std::fs::read(thumb_path(state, key, variant)?) {
        Ok(bytes) => Ok(Some(STANDARD.encode(bytes))),
        Err(_) => Ok(None),
    }
}

pub fn write(state: &AppState, key: &str, variant: &str, base64_jpeg: &str) -> Result<()> {
    let bytes = STANDARD
        .decode(base64_jpeg)
        .map_err(|e| Error::msg(format!("Bad thumbnail data: {e}")))?;
    let path = thumb_path(state, key, variant)?;
    // Drop this attachment's earlier variants so re-annotating a PDF
    // doesn't leave the cache growing a file per edit.
    if let Ok(entries) = std::fs::read_dir(thumbs_dir(state)?) {
        let prefix = format!("{key}_");
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && e.path() != path {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    std::fs::write(path, bytes)?;
    Ok(())
}
