//! Annotations made in the reader, on their way to Zotero.
//!
//! A highlight or underline made here is a Zotero annotation item from
//! the start — the frontend gives it its own item key and shows it at
//! once — but reaching Zotero can wait: the iPad reads cached PDFs
//! offline. So every create, edit and delete is written to an outbox
//! (`annotations-outbox.json` beside the library cache) and the outbox
//! is pushed whenever there is a connection.
//!
//! The outbox holds at most one entry per annotation: a later edit is
//! folded into whatever is still waiting (an edit of an unsent create
//! becomes part of the create, a delete of an unsent create cancels
//! both). Edits and deletes carry the version they were made against;
//! when Zotero has a newer one (the annotation was changed in Zotero
//! meanwhile) the version is refreshed and the write sent again — the
//! last edit wins, as it would in Zotero's own reader.

use crate::state::AppState;
use crate::zotero::annotations::{self as api, Created, Written};
use crate::{log, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Create,
    Update,
    Delete,
}

/// One waiting write. `data` is the whole item for a create, the
/// changed fields for an update, and unused for a delete.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Op {
    pub key: String,
    pub op: Kind,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub version: u64,
}

/// What a push did with one entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pushed {
    pub key: String,
    /// "created" | "updated" | "deleted" | "gone" | "rejected"
    pub status: &'static str,
    /// The item as Zotero now has it (created).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<Value>,
    /// The library version after the write (updated / deleted).
    pub version: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

fn lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn outbox_path(state: &AppState) -> PathBuf {
    state.data_dir.join("annotations-outbox.json")
}

fn load(state: &AppState) -> Vec<Op> {
    std::fs::read_to_string(outbox_path(state))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save(state: &AppState, ops: &[Op]) -> Result<()> {
    let path = outbox_path(state);
    if ops.is_empty() {
        let _ = std::fs::remove_file(path);
        return Ok(());
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(ops)?)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn merge_fields(into: &mut Value, patch: &Value) {
    if let (Some(into), Some(patch)) = (into.as_object_mut(), patch.as_object()) {
        for (k, v) in patch {
            into.insert(k.clone(), v.clone());
        }
    }
}

/// Fold `op` into the outbox, keeping one entry per annotation.
fn fold(ops: &mut Vec<Op>, op: Op) {
    let Some(i) = ops.iter().position(|o| o.key == op.key) else {
        ops.push(op);
        return;
    };
    match (ops[i].op, op.op) {
        (Kind::Create, Kind::Update) | (Kind::Update, Kind::Update) => {
            merge_fields(&mut ops[i].data, &op.data);
        }
        // Never reached Zotero, so there is nothing to delete there.
        (Kind::Create, Kind::Delete) => {
            ops.remove(i);
        }
        (Kind::Update, Kind::Delete) => {
            ops[i] = Op { version: ops[i].version.max(op.version), ..op };
        }
        // Nothing comes after a delete, and a create is never repeated.
        (Kind::Delete, _) | (_, Kind::Create) => {}
    }
}

/// The waiting writes — what the frontend lays over the library cache
/// at startup, so unsent annotations still show.
#[tauri::command]
pub async fn annotations_outbox(state: State<'_, AppState>) -> Result<Vec<Op>> {
    let _guard = lock().lock().await;
    Ok(load(&state))
}

/// Record a create, edit or delete for the next push.
#[tauri::command]
pub async fn annotations_enqueue(state: State<'_, AppState>, op: Op) -> Result<()> {
    let _guard = lock().lock().await;
    let mut ops = load(&state);
    fold(&mut ops, op);
    save(&state, &ops)
}

/// An update or delete, sent again once with Zotero's current version
/// if it had a newer one.
async fn write_with_retry(state: &AppState, op: &Op) -> Result<Written> {
    let send = |version: u64| async move {
        match op.op {
            Kind::Delete => api::delete(state, &op.key, version).await,
            _ => api::patch(state, &op.key, version, &op.data).await,
        }
    };
    match send(op.version).await? {
        Written::Conflict => match api::current_version(state, &op.key).await? {
            Some(v) => send(v).await,
            None => Ok(Written::Gone),
        },
        other => Ok(other),
    }
}

async fn push_one(state: &AppState, op: &Op) -> Result<Option<Pushed>> {
    let done = |status, item, version, message| Pushed {
        key: op.key.clone(),
        status,
        item,
        version,
        message,
    };
    if op.op == Kind::Create {
        return Ok(Some(match api::create(state, &op.data).await? {
            Created::Item(item) => {
                let v = item.get("version").and_then(Value::as_u64).unwrap_or(0);
                done("created", Some(item), v, None)
            }
            Created::Rejected(m) => done("rejected", None, 0, Some(m)),
        }));
    }
    Ok(match write_with_retry(state, op).await? {
        Written::Version(v) => {
            Some(done(if op.op == Kind::Delete { "deleted" } else { "updated" }, None, v, None))
        }
        // Gone from Zotero: a delete is done, an edit has nothing to edit.
        Written::Gone => Some(done("gone", None, 0, None)),
        // Changed again in the moment between: try on the next push.
        Written::Conflict => None,
    })
}

/// Send everything waiting. Entries that fail for a reason that may
/// pass (offline, a server error) stay for the next push.
#[tauri::command]
pub async fn annotations_push(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<Pushed>> {
    let _guard = lock().lock().await;
    let mut ops = load(&state);
    let mut out = Vec::new();
    let mut i = 0;
    while i < ops.len() {
        match push_one(&state, &ops[i]).await {
            Ok(Some(done)) => {
                if done.status == "rejected" {
                    let why = done.message.clone().unwrap_or_default();
                    log(&app, "error", format!("Zotero refused annotation {}: {why}", done.key));
                }
                out.push(done);
                ops.remove(i);
                save(&state, &ops)?;
            }
            Ok(None) => i += 1,
            Err(e) => {
                log(&app, "warn", format!("Annotation {} not sent yet (will retry): {e}", ops[i].key));
                i += 1;
            }
        }
    }
    if !out.is_empty() {
        log(&app, "info", format!("Sent {} annotation change(s) to Zotero", out.len()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn op(key: &str, kind: Kind, data: Value, version: u64) -> Op {
        Op { key: key.into(), op: kind, data, version }
    }

    #[test]
    fn edits_fold_into_an_unsent_create() {
        let mut ops = vec![op("AAAA2222", Kind::Create, json!({"annotationColor": "#ffd400"}), 0)];
        fold(&mut ops, op("AAAA2222", Kind::Update, json!({"annotationComment": "x"}), 0));
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, Kind::Create);
        assert_eq!(ops[0].data["annotationComment"], "x");
        assert_eq!(ops[0].data["annotationColor"], "#ffd400");
    }

    #[test]
    fn deleting_an_unsent_create_cancels_both() {
        let mut ops = vec![op("AAAA2222", Kind::Create, json!({}), 0)];
        fold(&mut ops, op("AAAA2222", Kind::Delete, Value::Null, 0));
        assert!(ops.is_empty());
    }

    #[test]
    fn a_delete_replaces_a_waiting_edit() {
        let mut ops = vec![op("BBBB3333", Kind::Update, json!({"annotationComment": "x"}), 41)];
        fold(&mut ops, op("BBBB3333", Kind::Delete, Value::Null, 0));
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].op, Kind::Delete);
        assert_eq!(ops[0].version, 41);
    }

    #[test]
    fn edits_merge_and_keys_stay_apart() {
        let mut ops = vec![op("BBBB3333", Kind::Update, json!({"annotationComment": "x"}), 41)];
        fold(&mut ops, op("BBBB3333", Kind::Update, json!({"annotationColor": "#5fb236"}), 41));
        fold(&mut ops, op("CCCC4444", Kind::Update, json!({"annotationComment": "y"}), 7));
        assert_eq!(ops.len(), 2);
        assert_eq!(ops[0].data["annotationComment"], "x");
        assert_eq!(ops[0].data["annotationColor"], "#5fb236");
    }
}
