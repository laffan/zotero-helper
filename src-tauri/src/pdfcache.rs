//! PDFs kept on this device, for reading alongside notes.
//!
//! Everything else in the app treats Zotero as the only home of a PDF
//! and fetches it fresh each time. Taking notes is different: the PDF
//! is open for an hour, possibly offline, and re-downloading a 30 MB
//! book every time the notes are opened would be absurd. So "Download
//! PDF" in the Notes tab puts a copy here, `pdfs/<attKey>.pdf`, with an
//! index describing each one for the Settings page, which is where the
//! cache is listed, measured and cleared. While a copy is here, every
//! other reader of that attachment (thumbnails, page citations, Ask Full
//! Papers) uses it too rather than going to the network.

use crate::state::AppState;
use crate::{zotero, Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CachedPdf {
    pub att_key: String,
    /// The entry the PDF belongs to (its own key for a standalone file).
    pub item_key: String,
    pub title: String,
    pub filename: String,
    pub size: u64,
    pub md5: String,
    pub saved_ms: u64,
}

type Index = BTreeMap<String, CachedPdf>;

fn dir(state: &AppState) -> Result<PathBuf> {
    let d = state.data_dir.join("pdfs");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

/// Zotero keys are alphanumeric; anything else must not reach a path.
fn checked(key: &str) -> Result<&str> {
    if !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric()) {
        Ok(key)
    } else {
        Err(Error::msg("Not a Zotero attachment key"))
    }
}

fn pdf_path(state: &AppState, att_key: &str) -> Result<PathBuf> {
    Ok(dir(state)?.join(format!("{}.pdf", checked(att_key)?)))
}

fn load_index(state: &AppState) -> Index {
    dir(state)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("index.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_index(state: &AppState, index: &Index) -> Result<()> {
    let path = dir(state)?.join("index.json");
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(index)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

/// The cached bytes of an attachment, when there are any.
pub fn read(state: &AppState, att_key: &str) -> Option<Vec<u8>> {
    std::fs::read(pdf_path(state, att_key).ok()?).ok()
}

/// Every cached PDF, with sizes re-read from disk so a file removed by
/// hand doesn't linger in the list.
pub fn list(state: &AppState) -> Vec<CachedPdf> {
    let mut out: Vec<CachedPdf> = Vec::new();
    for (key, mut entry) in load_index(state) {
        let Ok(path) = pdf_path(state, &key) else { continue };
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        entry.size = meta.len();
        out.push(entry);
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.saved_ms));
    out
}

/// Total bytes and number of cached PDFs.
pub fn usage(state: &AppState) -> (u64, usize) {
    let entries = list(state);
    (entries.iter().map(|e| e.size).sum(), entries.len())
}

// ---------------------------------------------------------------- commands

/// Download an attachment from Zotero into the cache (replacing any
/// earlier copy) and describe it.
#[tauri::command]
pub async fn cache_pdf(
    state: State<'_, AppState>,
    att_key: String,
    item_key: String,
    title: String,
    filename: String,
) -> Result<CachedPdf> {
    let path = pdf_path(&state, &att_key)?;
    let bytes = zotero::download_attachment(&state, &att_key).await?;
    if !bytes.starts_with(b"%PDF") {
        return Err(Error::msg("Zotero returned something that isn't a PDF"));
    }
    std::fs::write(&path, &bytes)?;
    let entry = CachedPdf {
        att_key: att_key.clone(),
        item_key,
        title,
        filename,
        size: bytes.len() as u64,
        md5: format!("{:x}", md5::compute(&bytes)),
        saved_ms: zotero::now_ms(),
    };
    let mut index = load_index(&state);
    index.insert(att_key, entry.clone());
    save_index(&state, &index)?;
    Ok(entry)
}

/// The cached PDF's bytes, or an error when it isn't cached.
#[tauri::command]
pub async fn read_cached_pdf(
    state: State<'_, AppState>,
    att_key: String,
) -> Result<tauri::ipc::Response> {
    read(&state, &att_key)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| Error::msg("That PDF isn't on this device"))
}

#[tauri::command]
pub async fn list_cached_pdfs(state: State<'_, AppState>) -> Result<Vec<CachedPdf>> {
    Ok(list(&state))
}

#[tauri::command]
pub async fn remove_cached_pdf(state: State<'_, AppState>, att_key: String) -> Result<()> {
    let _ = std::fs::remove_file(pdf_path(&state, &att_key)?);
    let mut index = load_index(&state);
    index.remove(&att_key);
    save_index(&state, &index)
}

/// Empty the cache. Returns how many PDFs were removed.
#[tauri::command]
pub async fn clear_pdf_cache(state: State<'_, AppState>) -> Result<usize> {
    let d = dir(&state)?;
    let mut removed = 0;
    for e in std::fs::read_dir(&d)?.flatten() {
        let path = e.path();
        if path.extension().is_some_and(|x| x == "pdf") && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    save_index(&state, &Index::new())?;
    Ok(removed)
}
