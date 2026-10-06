//! Reading notes: one NOTES.md per entry, written here and pushed to
//! Zotero as a child attachment of that entry.
//!
//! The copy being edited lives in `notes/<itemKey>.md`, beside an index
//! recording, per note, which attachment holds it in Zotero and the md5
//! of the file as last exchanged with Zotero (`synced_md5`). That md5 is
//! the whole sync protocol:
//!
//! - **Pull** (on opening the notes): if Zotero's file still has the
//!   synced md5, nothing changed there. If it differs, someone replaced
//!   it — the new text is taken, unless there are local edits not yet
//!   pushed, in which case the local text stays and Zotero's is kept
//!   beside it as `<itemKey>.conflict-<ms>.md`.
//! - **Push**: a replacement is sent with `If-Match: synced_md5`, so a
//!   file changed in Zotero meanwhile is never silently overwritten: the
//!   push stops, keeps Zotero's version as a conflict copy, and then
//!   sends the local text over it.
//!
//! Bi-directional editing isn't the expected use (the notes are written
//! here), so the conflict path aims only at never losing words.

use crate::state::AppState;
use crate::zotero::{self, files};
use crate::{log, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, State};

pub const FILENAME: &str = "NOTES.md";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct NoteMeta {
    pub item_key: String,
    /// The NOTES.md attachment in Zotero; empty until first pushed.
    pub att_key: String,
    /// md5 of the file as last exchanged with Zotero.
    pub synced_md5: String,
    /// Local edits not yet in Zotero.
    pub dirty: bool,
    pub edited_ms: u64,
    pub pushed_ms: u64,
    /// When Zotero was last asked whether its copy had changed.
    pub checked_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNote {
    pub text: String,
    pub meta: NoteMeta,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    /// "unchanged" | "updated" | "conflict" | "pushed" | "missing"
    pub status: String,
    pub text: Option<String>,
    pub meta: NoteMeta,
    /// The attachment item as Zotero now has it, for the library cache.
    pub item: Option<Value>,
}

type Index = BTreeMap<String, NoteMeta>;

/// Pushes and pulls of the same note must not interleave — two pushes
/// of a note that has no attachment yet would create two.
fn sync_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn dir(state: &AppState) -> Result<PathBuf> {
    let d = state.data_dir.join("notes");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

fn note_path(state: &AppState, item_key: &str) -> Result<PathBuf> {
    if item_key.is_empty() || !item_key.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(Error::msg("Not a Zotero item key"));
    }
    Ok(dir(state)?.join(format!("{item_key}.md")))
}

fn load_index(state: &AppState) -> Index {
    dir(state)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("index.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Read-modify-write one entry against the index as it is on disk now,
/// so a long network call never writes back a stale copy of the rest.
/// Serialized: a save can arrive on another thread mid-push.
fn update_meta(
    state: &AppState,
    item_key: &str,
    f: impl FnOnce(&mut NoteMeta),
) -> Result<NoteMeta> {
    static INDEX_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut index = load_index(state);
    let entry = index.entry(item_key.to_string()).or_insert_with(|| NoteMeta {
        item_key: item_key.to_string(),
        ..NoteMeta::default()
    });
    f(entry);
    let out = entry.clone();
    let path = dir(state)?.join("index.json");
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&index)?)?;
    std::fs::rename(tmp, path)?;
    Ok(out)
}

fn md5_of(bytes: &[u8]) -> String {
    format!("{:x}", md5::compute(bytes))
}

/// Keep Zotero's version of a note beside the local one.
fn save_conflict_copy(state: &AppState, item_key: &str, bytes: &[u8]) -> Result<PathBuf> {
    let path = dir(state)?.join(format!("{item_key}.conflict-{}.md", zotero::now_ms()));
    std::fs::write(&path, bytes)?;
    Ok(path)
}

/// Bytes and number of notes on this device.
pub fn usage(state: &AppState) -> (u64, usize) {
    let Ok(d) = dir(state) else { return (0, 0) };
    let mut bytes = 0;
    let mut count = 0;
    for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if name.ends_with(".md") {
            bytes += e.metadata().map(|m| m.len()).unwrap_or(0);
            if !name.contains(".conflict-") {
                count += 1;
            }
        }
    }
    (bytes, count)
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn notes_load(state: State<'_, AppState>, item_key: String) -> Result<Option<LocalNote>> {
    let path = note_path(&state, &item_key)?;
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Ok(None);
    };
    let meta = load_index(&state).remove(&item_key).unwrap_or(NoteMeta {
        item_key: item_key.clone(),
        dirty: true,
        ..NoteMeta::default()
    });
    Ok(Some(LocalNote { text, meta }))
}

/// Write the local copy. Pushing is separate and periodic.
#[tauri::command]
pub async fn notes_save(
    state: State<'_, AppState>,
    item_key: String,
    text: String,
) -> Result<NoteMeta> {
    let path = note_path(&state, &item_key)?;
    let tmp = path.with_extension("md.tmp");
    std::fs::write(&tmp, text.as_bytes())?;
    std::fs::rename(tmp, &path)?;
    let md5 = md5_of(text.as_bytes());
    update_meta(&state, &item_key, |m| {
        m.dirty = m.synced_md5 != md5;
        m.edited_ms = zotero::now_ms();
    })
}

/// Every note this device knows about — the periodic push walks the
/// dirty ones.
#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>) -> Result<Vec<NoteMeta>> {
    Ok(load_index(&state).into_values().collect())
}

/// Ask Zotero whether its NOTES.md changed, and take the new text if so.
/// `att_key` names the attachment when the library knows of one this
/// device has never synced (notes written on another machine).
#[tauri::command]
pub async fn notes_pull(
    app: AppHandle,
    state: State<'_, AppState>,
    item_key: String,
    att_key: Option<String>,
) -> Result<SyncOutcome> {
    let _guard = sync_lock().lock().await;
    let path = note_path(&state, &item_key)?;
    let mut meta = load_index(&state).remove(&item_key).unwrap_or_default();
    // The attachment this device last exchanged with, then the one the
    // library knows of (they differ when notes were deleted in Zotero
    // and written again elsewhere).
    let mut candidates: Vec<String> = Vec::new();
    for k in [Some(meta.att_key.clone()), att_key].into_iter().flatten() {
        if !k.is_empty() && !candidates.contains(&k) {
            candidates.push(k);
        }
    }
    if candidates.is_empty() {
        meta.item_key = item_key;
        return Ok(SyncOutcome { status: "unchanged".into(), text: None, meta, item: None });
    }
    let mut found: Option<(String, Value)> = None;
    for k in &candidates {
        if let Some(item) = files::get_item(&state, k).await? {
            found = Some((k.clone(), item));
            break;
        }
    }

    let Some((att, item)) = found else {
        // Deleted in Zotero. The local text is all there is now; mark it
        // for a push, which creates a fresh attachment.
        log(&app, "warn", format!("{FILENAME} for {item_key} is gone from Zotero — it will be re-uploaded"));
        let meta = update_meta(&state, &item_key, |m| {
            m.att_key.clear();
            m.synced_md5.clear();
            m.dirty = path.exists();
            m.checked_ms = zotero::now_ms();
        })?;
        return Ok(SyncOutcome { status: "missing".into(), text: None, meta, item: None });
    };
    // A different file from the one last synced: nothing about it is
    // known yet, so it counts as changed.
    let switched = att != meta.att_key;
    if switched {
        meta.synced_md5.clear();
    }
    let remote_md5 = item["data"]["md5"].as_str().unwrap_or("").to_string();
    let local_exists = path.exists();
    if remote_md5.is_empty() || (remote_md5 == meta.synced_md5 && local_exists) {
        let meta = update_meta(&state, &item_key, |m| {
            m.att_key = att.clone();
            if switched {
                m.synced_md5.clear();
            }
            m.checked_ms = zotero::now_ms();
        })?;
        return Ok(SyncOutcome { status: "unchanged".into(), text: None, meta, item: Some(item) });
    }

    let bytes = zotero::download_attachment(&state, &att).await?;
    let md5 = md5_of(&bytes);
    if local_exists && meta.dirty {
        let copy = save_conflict_copy(&state, &item_key, &bytes)?;
        log(
            &app,
            "warn",
            format!(
                "{FILENAME} changed in Zotero while this device had unpushed edits — kept yours, saved Zotero's as {}",
                copy.display()
            ),
        );
        // Point the next push at Zotero's current file so it replaces it.
        let meta = update_meta(&state, &item_key, |m| {
            m.att_key = att.clone();
            m.synced_md5 = md5;
            m.dirty = true;
            m.checked_ms = zotero::now_ms();
        })?;
        return Ok(SyncOutcome { status: "conflict".into(), text: None, meta, item: Some(item) });
    }

    std::fs::write(&path, &bytes)?;
    let meta = update_meta(&state, &item_key, |m| {
        m.att_key = att.clone();
        m.synced_md5 = md5;
        m.dirty = false;
        m.checked_ms = zotero::now_ms();
    })?;
    log(&app, "info", format!("Took the newer {FILENAME} for {item_key} from Zotero"));
    Ok(SyncOutcome {
        status: "updated".into(),
        text: Some(String::from_utf8_lossy(&bytes).into_owned()),
        meta,
        item: Some(item),
    })
}

/// Send the local NOTES.md to Zotero, creating its attachment the first
/// time. A file changed in Zotero since the last exchange is kept as a
/// conflict copy before the local text replaces it.
#[tauri::command]
pub async fn notes_push(
    app: AppHandle,
    state: State<'_, AppState>,
    item_key: String,
) -> Result<SyncOutcome> {
    let _guard = sync_lock().lock().await;
    let path = note_path(&state, &item_key)?;
    let bytes = std::fs::read(&path)?;
    let meta = load_index(&state).remove(&item_key).unwrap_or_default();

    let mut att = meta.att_key.clone();
    let mut previous = (!meta.synced_md5.is_empty()).then(|| meta.synced_md5.clone());
    if att.is_empty() {
        att = files::create_attachment_item(&state, &item_key, FILENAME, FILENAME, "text/markdown")
            .await?;
        previous = None;
        log(&app, "info", format!("Created {FILENAME} attachment {att} for {item_key}"));
        // Recorded now, so a failed upload can't orphan the attachment
        // and have the next push create a second one.
        update_meta(&state, &item_key, |m| {
            m.att_key = att.clone();
            m.synced_md5.clear();
        })?;
    }

    let mut outcome = files::upload_file(&app, &state, &att, &bytes, FILENAME, previous.as_deref()).await?;
    if let files::Upload::Conflict = outcome {
        let item = files::get_item(&state, &att).await?;
        let current = item
            .as_ref()
            .and_then(|i| i["data"]["md5"].as_str())
            .map(|s| s.to_string());
        if current.is_some() {
            let theirs = zotero::download_attachment(&state, &att).await?;
            let copy = save_conflict_copy(&state, &item_key, &theirs)?;
            log(
                &app,
                "warn",
                format!("{FILENAME} for {item_key} was changed in Zotero — saved that version as {}, sending yours over it", copy.display()),
            );
        }
        outcome = files::upload_file(&app, &state, &att, &bytes, FILENAME, current.as_deref()).await?;
    }
    let files::Upload::Stored(md5) = outcome else {
        return Err(Error::msg(format!("Zotero kept refusing {FILENAME} for {item_key}")));
    };

    // Edits saved while the upload ran keep the note dirty.
    let now_md5 = std::fs::read(&path).map(|b| md5_of(&b)).unwrap_or_default();
    let meta = update_meta(&state, &item_key, |m| {
        m.att_key = att.clone();
        m.synced_md5 = md5.clone();
        m.dirty = now_md5 != md5;
        m.pushed_ms = zotero::now_ms();
    })?;
    let item = files::get_item(&state, &att).await.ok().flatten();
    log(&app, "info", format!("Pushed {FILENAME} for {item_key} to Zotero"));
    Ok(SyncOutcome { status: "pushed".into(), text: None, meta, item })
}
