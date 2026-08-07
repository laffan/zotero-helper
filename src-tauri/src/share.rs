//! "Share" toolbar support: stage files in the app temp dir for the iOS
//! share sheet (tauri-plugin-share-sheet), and copy them out to
//! user-chosen destinations on desktop (where the frontend uses save /
//! folder dialogs instead of a share sheet).

use crate::state::AppState;
use crate::{zotero, Error, Result};
use std::path::{Path, PathBuf};

/// Keep a user-visible filename filesystem-safe without mangling
/// ordinary titles ("Attention Is All You Need.pdf" stays readable).
fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "document".into() } else { trimmed.chars().take(150).collect() }
}

fn share_dir(state: &AppState) -> Result<PathBuf> {
    let dir = state.tmp_dir().join("share");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Download a Zotero attachment into the share staging dir under a
/// readable name; returns the staged path.
pub async fn stage_attachment(
    state: &AppState,
    att_key: &str,
    file_name: &str,
) -> Result<String> {
    let bytes = zotero::download_attachment(state, att_key).await?;
    let mut name = sanitize_filename(file_name);
    if !name.to_ascii_lowercase().ends_with(".pdf") {
        name.push_str(".pdf");
    }
    let path = share_dir(state)?.join(name);
    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Write text content (e.g. the abstracts markdown) into the share
/// staging dir; returns the staged path.
pub fn stage_text(state: &AppState, file_name: &str, content: &str) -> Result<String> {
    let path = share_dir(state)?.join(sanitize_filename(file_name));
    std::fs::write(&path, content)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Desktop fallback: copy staged files into a user-chosen directory.
pub fn export_to_dir(paths: &[String], dest_dir: &str) -> Result<usize> {
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        return Err(Error::msg("Destination is not a folder"));
    }
    let mut copied = 0;
    for p in paths {
        let src = Path::new(p);
        let name = src
            .file_name()
            .ok_or_else(|| Error::msg("Staged file has no name"))?;
        std::fs::copy(src, dest.join(name))?;
        copied += 1;
    }
    Ok(copied)
}

/// Desktop fallback: copy one staged file to a full destination path
/// (from a save dialog).
pub fn export_to_file(src: &str, dest: &str) -> Result<()> {
    std::fs::copy(Path::new(src), Path::new(dest))?;
    Ok(())
}
