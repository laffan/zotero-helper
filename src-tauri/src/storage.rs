//! What this app keeps on the device, for the Settings page: the library
//! cache, the PDF cache, the thumbnail cache and the reading notes.

use crate::state::AppState;
use crate::{notes, pdfcache, Result};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub bytes: u64,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    /// library.json — items, collections and annotations.
    pub library: Usage,
    pub pdfs: Usage,
    pub thumbnails: Usage,
    pub notes: Usage,
}

fn dir_usage(dir: &Path) -> Usage {
    let mut u = Usage::default();
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if let Ok(m) = e.metadata() {
            if m.is_file() {
                u.bytes += m.len();
                u.files += 1;
            }
        }
    }
    u
}

#[tauri::command]
pub async fn storage_report(state: State<'_, AppState>) -> Result<StorageReport> {
    let library_bytes = std::fs::metadata(state.data_dir.join("library.json"))
        .map(|m| m.len())
        .unwrap_or(0);
    let (pdf_bytes, pdf_files) = pdfcache::usage(&state);
    let (note_bytes, note_files) = notes::usage(&state);
    Ok(StorageReport {
        library: Usage { bytes: library_bytes, files: usize::from(library_bytes > 0) },
        pdfs: Usage { bytes: pdf_bytes, files: pdf_files },
        thumbnails: dir_usage(&state.data_dir.join("thumbs")),
        notes: Usage { bytes: note_bytes, files: note_files },
    })
}

/// Drop every cached thumbnail; the icon view re-renders on demand.
#[tauri::command]
pub async fn clear_thumbnails(state: State<'_, AppState>) -> Result<usize> {
    let dir = state.data_dir.join("thumbs");
    let mut removed = 0;
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        if std::fs::remove_file(e.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}
